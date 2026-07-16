import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import { withTransaction } from '../persistence/transaction.js';

export async function recoverExpiredLeases(pool: pg.Pool): Promise<number> {
  return withTransaction(pool, async (client) => {
    const expired = await client.query<{
      execution_id: string;
      attempt_id: string;
      external_run_ref: string | null;
      safe_provider_output_ref: string | null;
      trace_id: string;
    }>(
      `select e.id as execution_id, a.id as attempt_id,
              a.external_run_ref, a.safe_provider_output_ref, r.trace_id
         from execution.executions e
         join execution.execution_requests r on r.id=e.request_id
         join execution.execution_attempts a on a.execution_id=e.id
        where e.status='running' and a.status='running'
          and a.lease_expires_at<=now()
        order by a.lease_expires_at asc, e.id asc
        for update of e, a skip locked`,
    );

    for (const row of expired.rows) {
      const uncertain = Boolean(row.external_run_ref || row.safe_provider_output_ref);
      const nextState = uncertain ? 'reconciliation-required' : 'queued';
      await client.query(
        `update execution.execution_attempts
            set status=$2, worker_id=null, lease_token=null,
                lease_expires_at=null, heartbeat_at=null, updated_at=now()
          where id=$1`,
        [row.attempt_id, nextState],
      );
      await client.query(
        `update execution.executions
            set status=$2, lock_version=lock_version+1, updated_at=now()
          where id=$1`,
        [row.execution_id, nextState],
      );
      await client.query(
        `insert into execution.execution_status_transitions
          (event_key, execution_id, attempt_id, from_status, to_status,
           reason_family, actor_type, trace_id, safe_metadata)
         values ($1,$2,$3,'running',$4,'lease-expired','recovery',$5,$6)`,
        [
          randomUUID(),
          row.execution_id,
          row.attempt_id,
          nextState,
          row.trace_id,
          { externalRunKnown: Boolean(row.external_run_ref) },
        ],
      );
      if (uncertain) {
        await client.query(
          `insert into execution.execution_reconciliation_cases
            (id, execution_id, attempt_id, case_type, status, reason_family,
             safe_details, detected_at, next_check_at)
           values ($1,$2,$3,'lease-loss','open','reconciliation-required',$4,now(),now())
           on conflict do nothing`,
          [
            randomUUID(),
            row.execution_id,
            row.attempt_id,
            {
              externalRunKnown: Boolean(row.external_run_ref),
              safeProviderOutputKnown: Boolean(row.safe_provider_output_ref),
            },
          ],
        );
      }
    }

    return expired.rowCount ?? 0;
  });
}
