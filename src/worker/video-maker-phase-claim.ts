import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import type { VideoMakerExecutionRequestV1 } from '../contracts/video-maker/v1/execution.js';
import { withTransaction } from '../persistence/transaction.js';
import { validateVideoMakerExecutionRequest } from '../validation/video-maker-request.js';
import {
  type VideoMakerPhaseKey,
  type VideoMakerPhaseOutcomeKind,
} from './video-maker-phase-runner.js';

export interface PhaseClaim {
  executionId: string;
  phaseAttemptId: string;
  leaseToken: string;
  phaseKey: VideoMakerPhaseKey;
  phaseOrdinal: number;
  attemptNumber: number;
  request: VideoMakerExecutionRequestV1;
  safeContinuationRef?: string;
}

export function attemptStatus(kind: VideoMakerPhaseOutcomeKind): string {
  return kind.toLowerCase().replaceAll('_', '-');
}

export async function appendVideoMakerTransition(
  client: pg.PoolClient,
  input: {
    executionId: string;
    fromStatus: string | null;
    toStatus: string;
    reasonFamily: string;
    actorRef: string;
    traceId: string;
    safeMetadata?: Record<string, unknown>;
  },
): Promise<void> {
  await client.query(
    `insert into execution.execution_status_transitions
      (event_key, execution_id, from_status, to_status, reason_family,
       actor_type, actor_ref, trace_id, safe_metadata)
     values ($1,$2,$3,$4,$5,'worker',$6,$7,$8)`,
    [
      randomUUID(),
      input.executionId,
      input.fromStatus,
      input.toStatus,
      input.reasonFamily,
      input.actorRef,
      input.traceId,
      input.safeMetadata ?? {},
    ],
  );
}

export async function appendVideoMakerEvidence(
  client: pg.PoolClient,
  input: {
    executionId: string;
    phaseAttemptId: string;
    evidenceKind: 'claimed' | 'outcome' | 'lease-recovered' | 'shutdown' | 'reconciliation';
    safeEvidence?: Record<string, unknown>;
  },
): Promise<void> {
  await client.query(
    `insert into execution.execution_phase_evidence
      (event_key, execution_id, phase_attempt_id, evidence_kind, safe_evidence)
     values ($1,$2,$3,$4,$5)`,
    [
      randomUUID(),
      input.executionId,
      input.phaseAttemptId,
      input.evidenceKind,
      input.safeEvidence ?? {},
    ],
  );
}

export async function acquirePhaseClaim(
  pool: pg.Pool,
  workerId: string,
  leaseSeconds: number,
): Promise<PhaseClaim | null> {
  return withTransaction(pool, async (client) => {
    const selected = await client.query<{
      execution_id: string;
      status: string;
      current_phase_key: VideoMakerPhaseKey;
      current_phase_ordinal: number;
      request_envelope: unknown;
      safe_continuation_ref: string | null;
    }>(
      `select e.id as execution_id, e.status, e.current_phase_key,
              e.current_phase_ordinal, r.request_envelope, e.safe_continuation_ref
         from execution.executions e
         join execution.execution_requests r on r.id=e.request_id
        where r.contract_version='zx.video-maker.execution.v1'
          and e.selected_execution_method is not null
          and e.current_phase_key is not null
          and e.status in ('accepted','queued')
          and e.cancellation_requested_at is null
          and (e.next_phase_eligible_at is null or e.next_phase_eligible_at<=now())
          and not exists (
            select 1 from execution.execution_reconciliation_cases c
             where c.execution_id=e.id and c.status in ('open','resolving')
          )
          and not exists (
            select 1 from execution.execution_phase_attempts p
             where p.execution_id=e.id and p.status='running' and p.lease_expires_at>now()
          )
        order by e.priority desc, e.created_at asc, e.id asc
        for update of e skip locked
        limit 1`,
    );
    const row = selected.rows[0];
    if (!row) return null;

    const request = validateVideoMakerExecutionRequest(row.request_envelope);
    const count = await client.query<{ attempt_number: number }>(
      `select coalesce(max(attempt_number),0)::int + 1 as attempt_number
         from execution.execution_phase_attempts
        where execution_id=$1 and phase_ordinal=$2`,
      [row.execution_id, row.current_phase_ordinal],
    );
    const attemptNumber = count.rows[0]?.attempt_number ?? 1;
    if (attemptNumber > request.retryPolicy.maxAttempts) {
      const failure = {
        contractVersion: 'zx.video-maker.failure.v1',
        code: 'ZX_VM_PHASE_ATTEMPTS_EXHAUSTED',
        message: 'bounded phase attempt policy was exhausted',
        retryable: false,
        phaseKey: row.current_phase_key,
        attemptNumber: request.retryPolicy.maxAttempts,
        traceId: request.traceId,
      };
      await client.query(
        `update execution.executions
            set status='failed', current_phase_key=null, current_phase_ordinal=null,
                next_phase_eligible_at=null, error_envelope=$2, terminal_at=now(),
                lock_version=lock_version+1, updated_at=now()
          where id=$1`,
        [row.execution_id, failure],
      );
      await appendVideoMakerTransition(client, {
        executionId: row.execution_id,
        fromStatus: row.status,
        toStatus: 'failed',
        reasonFamily: 'phase-attempts-exhausted',
        actorRef: workerId,
        traceId: request.traceId,
        safeMetadata: {
          phaseKey: row.current_phase_key,
          maximumAttempts: request.retryPolicy.maxAttempts,
        },
      });
      return null;
    }

    const phaseAttemptId = randomUUID();
    const leaseToken = randomUUID();
    await client.query(
      `insert into execution.execution_phase_attempts
        (id, execution_id, phase_key, phase_ordinal, attempt_number, status,
         retry_count, worker_id, lease_token, lease_expires_at, started_at)
       values ($1,$2,$3,$4,$5,'running',$6,$7,$8,
               now()+make_interval(secs=>$9),now())`,
      [
        phaseAttemptId,
        row.execution_id,
        row.current_phase_key,
        row.current_phase_ordinal,
        attemptNumber,
        attemptNumber - 1,
        workerId,
        leaseToken,
        leaseSeconds,
      ],
    );
    await appendVideoMakerEvidence(client, {
      executionId: row.execution_id,
      phaseAttemptId,
      evidenceKind: 'claimed',
      safeEvidence: {
        phaseKey: row.current_phase_key,
        phaseOrdinal: row.current_phase_ordinal,
        attemptNumber,
      },
    });
    await client.query(
      `update execution.executions
          set status='running', next_phase_eligible_at=null,
              lock_version=lock_version+1, updated_at=now()
        where id=$1`,
      [row.execution_id],
    );
    await appendVideoMakerTransition(client, {
      executionId: row.execution_id,
      fromStatus: row.status,
      toStatus: 'running',
      reasonFamily: 'phase-claimed',
      actorRef: workerId,
      traceId: request.traceId,
      safeMetadata: {
        phaseAttemptId,
        phaseKey: row.current_phase_key,
        attemptNumber,
      },
    });

    return {
      executionId: row.execution_id,
      phaseAttemptId,
      leaseToken,
      phaseKey: row.current_phase_key,
      phaseOrdinal: row.current_phase_ordinal,
      attemptNumber,
      request,
      ...(row.safe_continuation_ref === null
        ? {}
        : { safeContinuationRef: row.safe_continuation_ref }),
    };
  });
}
