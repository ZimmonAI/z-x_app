import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import { withTransaction } from '../persistence/transaction.js';
import { type VideoMakerPhaseKey } from './video-maker-phase-runner.js';
import {
  appendVideoMakerEvidence,
  appendVideoMakerTransition,
} from './video-maker-phase-claim.js';

export async function recoverExpiredVideoMakerPhaseLeases(pool: pg.Pool): Promise<number> {
  return withTransaction(pool, async (client) => {
    const expired = await client.query<{
      execution_id: string;
      phase_attempt_id: string;
      phase_key: VideoMakerPhaseKey;
      attempt_number: number;
      trace_id: string;
      cancellation_requested_at: Date | null;
    }>(
      `select e.id as execution_id, p.id as phase_attempt_id, p.phase_key,
              p.attempt_number, r.trace_id, e.cancellation_requested_at
         from execution.execution_phase_attempts p
         join execution.executions e on e.id=p.execution_id
         join execution.execution_requests r on r.id=e.request_id
        where p.status='running' and p.lease_expires_at<=now()
          and e.selected_execution_method is not null
          and e.status='running'
        order by p.lease_expires_at asc
        for update of e, p skip locked
        limit 20`,
    );

    for (const row of expired.rows) {
      const stopped = row.cancellation_requested_at !== null;
      const phaseStatus = stopped ? 'stopped' : 'uncertain';
      const executionStatus = stopped ? 'cancelled' : 'reconciliation-required';
      const failure = {
        contractVersion: 'zx.video-maker.failure.v1',
        code: stopped ? 'ZX_VM_CANCELLED_AFTER_LEASE_LOSS' : 'ZX_VM_PHASE_LEASE_LOST',
        message: stopped
          ? 'cancellation was preserved after phase lease loss'
          : 'phase lease expired with an uncertain outcome',
        retryable: false,
        phaseKey: row.phase_key,
        attemptNumber: row.attempt_number,
        traceId: row.trace_id,
      };
      await client.query(
        `update execution.execution_phase_attempts
            set status=$2, completed_at=now(), normalized_failure=$3
          where id=$1 and status='running'`,
        [row.phase_attempt_id, phaseStatus, failure],
      );
      await appendVideoMakerEvidence(client, {
        executionId: row.execution_id,
        phaseAttemptId: row.phase_attempt_id,
        evidenceKind: 'lease-recovered',
        safeEvidence: {
          phaseAttemptId: row.phase_attempt_id,
          phaseKey: row.phase_key,
          attemptNumber: row.attempt_number,
          cancellationRequested: stopped,
          consequentialSubmit: row.phase_key === 'submit',
        },
      });
      if (!stopped) {
        await client.query(
          `insert into execution.execution_reconciliation_cases
            (id, execution_id, attempt_id, case_type, status, reason_family,
             safe_details, detected_at, next_check_at)
           values ($1,$2,null,'phase-uncertainty','open','reconciliation-required',$3,now(),now())
           on conflict do nothing`,
          [
            randomUUID(),
            row.execution_id,
            {
              phaseAttemptId: row.phase_attempt_id,
              phaseKey: row.phase_key,
              leaseExpired: true,
            },
          ],
        );
      }
      await client.query(
        `update execution.executions
            set status=$2,
                current_phase_key=case when $3 then null else current_phase_key end,
                current_phase_ordinal=case when $3 then null else current_phase_ordinal end,
                next_phase_eligible_at=null,
                error_envelope=$4,
                terminal_at=case when $3 then now() else null end,
                lock_version=lock_version+1,
                updated_at=now()
          where id=$1 and status='running'`,
        [row.execution_id, executionStatus, stopped, failure],
      );
      await appendVideoMakerTransition(client, {
        executionId: row.execution_id,
        fromStatus: 'running',
        toStatus: executionStatus,
        reasonFamily: stopped ? 'phase-stopped' : 'phase-lease-lost',
        actorRef: 'lease-recovery',
        traceId: row.trace_id,
        safeMetadata: {
          phaseAttemptId: row.phase_attempt_id,
          phaseKey: row.phase_key,
          attemptNumber: row.attempt_number,
        },
      });
    }

    return expired.rowCount ?? 0;
  });
}
