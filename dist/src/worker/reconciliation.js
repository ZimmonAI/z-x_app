import { randomUUID } from 'node:crypto';
import { fixtureScenario } from '../adapters/types.js';
import { SafeExecutionError } from '../contracts/v1/error.js';
import { withTransaction } from '../persistence/transaction.js';
import { validateExecutionRequest } from '../validation/request.js';
function toSafeError(error, traceId) {
    if (error instanceof SafeExecutionError)
        return error.safe;
    return {
        family: 'internal-safe-failure',
        code: 'ZX_MANUAL_RETRY_PREPARATION_FAILED',
        message: 'manual retry preparation failed safely',
        retryable: true,
        traceId,
    };
}
async function claimManualRetry(pool, workerId, leaseSeconds) {
    return withTransaction(pool, async (client) => {
        const selected = await client.query(`select e.id as execution_id, a.id as attempt_id, c.id as case_id,
              r.request_envelope
         from execution.executions e
         join execution.execution_requests r on r.id=e.request_id
         join execution.execution_attempts a
           on a.execution_id=e.id and a.attempt_number=e.current_attempt_number
         join execution.execution_reconciliation_cases c
           on c.execution_id=e.id and c.attempt_id=a.id
          and c.case_type='manual-retry' and c.status='open'
        where e.status='queued' and a.status='queued'
          and a.route_snapshot is null and a.capacity_snapshot is null
          and (a.lease_expires_at is null or a.lease_expires_at<=now())
        order by c.detected_at asc, e.created_at asc, e.id asc
        for update of e, a, c skip locked
        limit 1`);
        const row = selected.rows[0];
        if (!row)
            return null;
        const leaseToken = randomUUID();
        const claimed = await client.query(`update execution.execution_attempts
          set status='resolving-route', worker_id=$2, lease_token=$3,
              lease_expires_at=now()+make_interval(secs=>$4),
              heartbeat_at=now(), updated_at=now()
        where id=$1 and status='queued'
          and route_snapshot is null and capacity_snapshot is null
        returning id`, [row.attempt_id, workerId, leaseToken, leaseSeconds]);
        if (!claimed.rowCount)
            return null;
        return {
            executionId: row.execution_id,
            attemptId: row.attempt_id,
            caseId: row.case_id,
            leaseToken,
            request: validateExecutionRequest(row.request_envelope),
        };
    });
}
export async function prepareManualRetry(pool, workerId, leaseSeconds, dependencies, signal = new AbortController().signal) {
    const claim = await claimManualRetry(pool, workerId, leaseSeconds);
    if (!claim)
        return false;
    try {
        const scenario = fixtureScenario(claim.request);
        const route = await dependencies.routes.resolveAndValidateRoute({
            operation: claim.request.operationType,
            routeLocks: claim.request.routeLocks,
            fixtureScenario: scenario,
        }, signal);
        const capacity = await dependencies.capacity.acquire({ route, fixtureScenario: scenario }, signal);
        await withTransaction(pool, async (client) => {
            const attempt = await client.query(`update execution.execution_attempts
            set status='queued', route_snapshot=$4, capacity_snapshot=$5,
                worker_id=null, lease_token=null, lease_expires_at=null,
                heartbeat_at=null, error_family=null, error_code=null,
                error_message=null, updated_at=now()
          where id=$1 and execution_id=$2 and lease_token=$3
            and lease_expires_at>now() and status='resolving-route'
          returning id`, [claim.attemptId, claim.executionId, claim.leaseToken, route, capacity]);
            if (!attempt.rowCount)
                throw new Error('manual retry preparation lease lost');
            const execution = await client.query(`update execution.executions
            set lock_version=lock_version+1, updated_at=now()
          where id=$1 and status='queued'
          returning id`, [claim.executionId]);
            if (!execution.rowCount)
                throw new Error('manual retry queue state changed');
            await client.query(`update execution.execution_reconciliation_cases
            set status='resolving', reason_family='manual-retry',
                safe_details=$2, next_check_at=now(), updated_at=now()
          where id=$1 and status='open'`, [
                claim.caseId,
                {
                    routeId: route.routeId,
                    routeVersion: route.routeVersion,
                    runtimeBindingRef: capacity.runtimeBindingRef,
                },
            ]);
        });
        return true;
    }
    catch (error) {
        const failure = toSafeError(error, claim.request.traceId);
        await withTransaction(pool, async (client) => {
            const attempt = await client.query(`update execution.execution_attempts
            set status='queued', error_family=$4, error_code=$5, error_message=$6,
                completed_at=null, worker_id=null, lease_token=null,
                lease_expires_at=null, heartbeat_at=null, updated_at=now()
          where id=$1 and execution_id=$2 and lease_token=$3
          returning id`, [
                claim.attemptId,
                claim.executionId,
                claim.leaseToken,
                failure.family,
                failure.code,
                failure.message,
            ]);
            if (!attempt.rowCount)
                throw new Error('manual retry failure lease lost');
            await client.query(`update execution.execution_reconciliation_cases
            set reason_family=$2, safe_details=$3,
                next_check_at=now()+case when $4 then interval '5 seconds' else interval '1 hour' end,
                updated_at=now()
          where id=$1 and status='open'`, [
                claim.caseId,
                failure.family,
                { code: failure.code, retryable: failure.retryable },
                failure.retryable,
            ]);
        });
        return true;
    }
}
export async function recoverExpiredLeases(pool) {
    return withTransaction(pool, async (client) => {
        const expired = await client.query(`select e.id as execution_id, a.id as attempt_id,
              a.external_run_ref, a.safe_provider_output_ref, r.trace_id
         from execution.executions e
         join execution.execution_requests r on r.id=e.request_id
         join execution.execution_attempts a on a.execution_id=e.id
        where e.status='running' and a.status='running'
          and a.lease_expires_at<=now()
        order by a.lease_expires_at asc, e.id asc
        for update of e, a skip locked`);
        for (const row of expired.rows) {
            const uncertain = Boolean(row.external_run_ref || row.safe_provider_output_ref);
            const nextState = uncertain ? 'reconciliation-required' : 'queued';
            await client.query(`update execution.execution_attempts
            set status=$2, worker_id=null, lease_token=null,
                lease_expires_at=null, heartbeat_at=null, updated_at=now()
          where id=$1`, [row.attempt_id, nextState]);
            await client.query(`update execution.executions
            set status=$2, lock_version=lock_version+1, updated_at=now()
          where id=$1`, [row.execution_id, nextState]);
            await client.query(`insert into execution.execution_status_transitions
          (event_key, execution_id, attempt_id, from_status, to_status,
           reason_family, actor_type, trace_id, safe_metadata)
         values ($1,$2,$3,'running',$4,'lease-expired','recovery',$5,$6)`, [
                randomUUID(),
                row.execution_id,
                row.attempt_id,
                nextState,
                row.trace_id,
                { externalRunKnown: Boolean(row.external_run_ref) },
            ]);
            if (uncertain) {
                await client.query(`insert into execution.execution_reconciliation_cases
            (id, execution_id, attempt_id, case_type, status, reason_family,
             safe_details, detected_at, next_check_at)
           values ($1,$2,$3,'lease-loss','open','reconciliation-required',$4,now(),now())
           on conflict do nothing`, [
                    randomUUID(),
                    row.execution_id,
                    row.attempt_id,
                    {
                        externalRunKnown: Boolean(row.external_run_ref),
                        safeProviderOutputKnown: Boolean(row.safe_provider_output_ref),
                    },
                ]);
            }
        }
        return expired.rowCount ?? 0;
    });
}
//# sourceMappingURL=reconciliation.js.map