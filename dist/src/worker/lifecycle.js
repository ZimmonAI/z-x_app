import { randomUUID } from 'node:crypto';
import { getAdapter } from '../adapters/registry.js';
import { fixtureScenario } from '../adapters/types.js';
import { SafeExecutionError } from '../contracts/v1/error.js';
import { ExecutionResultV1Schema } from '../contracts/v1/result.js';
import { withTransaction } from '../persistence/transaction.js';
import { validateExecutionRequest } from '../validation/request.js';
function toSafeError(error, traceId) {
    if (error instanceof SafeExecutionError)
        return error.safe;
    return {
        family: 'internal-safe-failure',
        code: 'ZX_INTERNAL_SAFE_FAILURE',
        message: 'execution failed safely',
        retryable: true,
        traceId,
    };
}
async function appendTransition(client, input) {
    await client.query(`insert into execution.execution_status_transitions
      (event_key, execution_id, attempt_id, from_status, to_status, reason_family,
       actor_type, actor_ref, trace_id, safe_metadata)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`, [
        randomUUID(),
        input.executionId,
        input.attemptId ?? null,
        input.fromStatus,
        input.toStatus,
        input.reasonFamily,
        input.actorType,
        input.actorRef ?? null,
        input.traceId,
        input.safeMetadata ?? {},
    ]);
}
export async function executePreparedFixturePath(request, executionId, route, capacity, dependencies, signal = new AbortController().signal) {
    const adapter = getAdapter(request.operationType, route.adapterId, route.adapterVersion, route.invocationMode);
    return adapter.execute({
        request,
        route,
        capacity,
        executionId,
        signal,
        autoHub: dependencies.autoHub,
        storage: dependencies.storage,
    });
}
export async function executeFixturePath(request, executionId, dependencies, signal = new AbortController().signal) {
    const scenario = fixtureScenario(request);
    const route = await dependencies.routes.resolveAndValidateRoute({
        operation: request.operationType,
        routeLocks: request.routeLocks,
        fixtureScenario: scenario,
    }, signal);
    const capacity = await dependencies.capacity.acquire({ route, fixtureScenario: scenario }, signal);
    let outcome = 'failed';
    try {
        const result = await executePreparedFixturePath(request, executionId, route, capacity, dependencies, signal);
        outcome = 'succeeded';
        return result;
    }
    finally {
        await dependencies.capacity.reportOutcome({ leaseRef: capacity.leaseRef, outcome }, signal);
        await dependencies.capacity.release({ leaseRef: capacity.leaseRef }, signal);
    }
}
async function acquirePreparationClaim(pool, workerId, leaseSeconds) {
    return withTransaction(pool, async (client) => {
        const selected = await client.query(`select e.id as execution_id, e.status, e.current_attempt_number,
              r.request_envelope, r.trace_id,
              a.id as attempt_id, a.route_snapshot
         from execution.executions e
         join execution.execution_requests r on r.id=e.request_id
         left join lateral (
           select id, route_snapshot, lease_expires_at
             from execution.execution_attempts
            where execution_id=e.id
            order by attempt_number desc
            limit 1
         ) a on true
        where e.status in ('accepted','waiting-capacity')
          and (a.lease_expires_at is null or a.lease_expires_at<=now())
        order by e.priority desc, e.created_at asc, e.id asc
        for update of e skip locked
        limit 1`);
        const row = selected.rows[0];
        if (!row)
            return null;
        const request = validateExecutionRequest(row.request_envelope);
        const attemptId = row.attempt_id ?? randomUUID();
        const leaseToken = randomUUID();
        if (row.status === 'accepted') {
            const attemptNumber = row.current_attempt_number + 1;
            await client.query(`insert into execution.execution_attempts
          (id, execution_id, attempt_number, status, worker_id, lease_token,
           lease_expires_at, heartbeat_at, started_at)
         values ($1,$2,$3,'resolving-route',$4,$5,
                 now()+make_interval(secs=>$6),now(),now())`, [attemptId, row.execution_id, attemptNumber, workerId, leaseToken, leaseSeconds]);
            await client.query(`update execution.executions
            set status='resolving-route', current_attempt_number=$2,
                lock_version=lock_version+1, updated_at=now()
          where id=$1`, [row.execution_id, attemptNumber]);
            await appendTransition(client, {
                executionId: row.execution_id,
                attemptId,
                fromStatus: 'accepted',
                toStatus: 'resolving-route',
                reasonFamily: 'dispatch-preparation',
                actorType: 'worker',
                actorRef: workerId,
                traceId: row.trace_id,
            });
        }
        else {
            if (!row.attempt_id || !row.route_snapshot) {
                throw new Error('waiting-capacity execution lacks its route snapshot');
            }
            const claimed = await client.query(`update execution.execution_attempts
            set worker_id=$2, lease_token=$3,
                lease_expires_at=now()+make_interval(secs=>$4),
                heartbeat_at=now(), updated_at=now()
          where id=$1 and (lease_expires_at is null or lease_expires_at<=now())
          returning id`, [attemptId, workerId, leaseToken, leaseSeconds]);
            if (!claimed.rowCount)
                return null;
        }
        return {
            executionId: row.execution_id,
            attemptId,
            leaseToken,
            request,
            route: row.route_snapshot ?? undefined,
        };
    });
}
async function persistPreparationFailure(pool, claim, error, workerId) {
    await withTransaction(pool, async (client) => {
        const stateResult = await client.query('select status from execution.executions where id=$1 for update', [claim.executionId]);
        const currentState = stateResult.rows[0]?.status;
        if (!currentState)
            throw new Error('execution disappeared during preparation');
        const waitingForCapacity = error.family === 'no-eligible-capacity';
        const attempt = await client.query(`update execution.execution_attempts
          set status=$4, error_family=$5, error_code=$6, error_message=$7,
              completed_at=case when $4='failed' then now() else completed_at end,
              worker_id=null, lease_token=null, lease_expires_at=null, heartbeat_at=null,
              updated_at=now()
        where id=$1 and execution_id=$2 and lease_token=$3 and lease_expires_at>now()
        returning id`, [
            claim.attemptId,
            claim.executionId,
            claim.leaseToken,
            waitingForCapacity ? 'waiting-capacity' : 'failed',
            error.family,
            error.code,
            error.message,
        ]);
        if (!attempt.rowCount)
            throw new Error('preparation lease lost');
        if (waitingForCapacity) {
            if (currentState !== 'waiting-capacity') {
                await client.query(`update execution.executions
              set status='waiting-capacity', lock_version=lock_version+1, updated_at=now()
            where id=$1`, [claim.executionId]);
                await appendTransition(client, {
                    executionId: claim.executionId,
                    attemptId: claim.attemptId,
                    fromStatus: currentState,
                    toStatus: 'waiting-capacity',
                    reasonFamily: error.family,
                    actorType: 'worker',
                    actorRef: workerId,
                    traceId: claim.request.traceId,
                    safeMetadata: { code: error.code },
                });
            }
            return;
        }
        await client.query(`update execution.executions
          set status='failed', error_envelope=$2, terminal_at=now(),
              lock_version=lock_version+1, updated_at=now()
        where id=$1`, [claim.executionId, error]);
        await appendTransition(client, {
            executionId: claim.executionId,
            attemptId: claim.attemptId,
            fromStatus: currentState,
            toStatus: 'failed',
            reasonFamily: error.family,
            actorType: 'worker',
            actorRef: workerId,
            traceId: claim.request.traceId,
            safeMetadata: { code: error.code },
        });
    });
}
export async function prepareNextExecution(pool, workerId, leaseSeconds, dependencies, signal = new AbortController().signal) {
    const claim = await acquirePreparationClaim(pool, workerId, leaseSeconds);
    if (!claim)
        return false;
    try {
        const scenario = fixtureScenario(claim.request);
        const route = claim.route ??
            (await dependencies.routes.resolveAndValidateRoute({
                operation: claim.request.operationType,
                routeLocks: claim.request.routeLocks,
                fixtureScenario: scenario,
            }, signal));
        if (!claim.route) {
            await withTransaction(pool, async (client) => {
                const attempt = await client.query(`update execution.execution_attempts
              set status='waiting-capacity', route_snapshot=$4, updated_at=now()
            where id=$1 and execution_id=$2 and lease_token=$3 and lease_expires_at>now()
            returning id`, [claim.attemptId, claim.executionId, claim.leaseToken, route]);
                if (!attempt.rowCount)
                    throw new Error('preparation lease lost');
                await client.query(`update execution.executions
              set status='waiting-capacity', lock_version=lock_version+1, updated_at=now()
            where id=$1 and status='resolving-route'`, [claim.executionId]);
                await appendTransition(client, {
                    executionId: claim.executionId,
                    attemptId: claim.attemptId,
                    fromStatus: 'resolving-route',
                    toStatus: 'waiting-capacity',
                    reasonFamily: 'route-resolved',
                    actorType: 'worker',
                    actorRef: workerId,
                    traceId: claim.request.traceId,
                    safeMetadata: { routeId: route.routeId, routeVersion: route.routeVersion },
                });
            });
        }
        const capacity = await dependencies.capacity.acquire({ route, fixtureScenario: scenario }, signal);
        await withTransaction(pool, async (client) => {
            const attempt = await client.query(`update execution.execution_attempts
            set status='queued', capacity_snapshot=$4,
                worker_id=null, lease_token=null, lease_expires_at=null, heartbeat_at=null,
                error_family=null, error_code=null, error_message=null, updated_at=now()
          where id=$1 and execution_id=$2 and lease_token=$3 and lease_expires_at>now()
          returning id`, [claim.attemptId, claim.executionId, claim.leaseToken, capacity]);
            if (!attempt.rowCount)
                throw new Error('preparation lease lost');
            await client.query(`update execution.executions
            set status='queued', lock_version=lock_version+1, updated_at=now()
          where id=$1 and status='waiting-capacity'`, [claim.executionId]);
            await appendTransition(client, {
                executionId: claim.executionId,
                attemptId: claim.attemptId,
                fromStatus: 'waiting-capacity',
                toStatus: 'queued',
                reasonFamily: 'capacity-acquired',
                actorType: 'worker',
                actorRef: workerId,
                traceId: claim.request.traceId,
                safeMetadata: { routeId: route.routeId },
            });
        });
        return true;
    }
    catch (error) {
        await persistPreparationFailure(pool, claim, toSafeError(error, claim.request.traceId), workerId);
        return true;
    }
}
export async function completeClaimedExecution(pool, claim, workerId, dependencies, signal = new AbortController().signal) {
    const loaded = await pool.query(`select r.request_envelope, a.route_snapshot, a.capacity_snapshot, a.started_at
       from execution.executions e
       join execution.execution_requests r on r.id=e.request_id
       join execution.execution_attempts a on a.execution_id=e.id
      where e.id=$1 and a.id=$2 and a.lease_token=$3
        and a.lease_expires_at>now() and e.status='running' and a.status='running'`, [claim.executionId, claim.attemptId, claim.leaseToken]);
    const row = loaded.rows[0];
    if (!row?.route_snapshot || !row.capacity_snapshot) {
        throw new Error('claimed execution is missing or lease was lost');
    }
    const request = validateExecutionRequest(row.request_envelope);
    let capacityOutcome = 'failed';
    try {
        const output = await executePreparedFixturePath(request, claim.executionId, row.route_snapshot, row.capacity_snapshot, dependencies, signal);
        const completedAt = new Date().toISOString();
        const result = ExecutionResultV1Schema.parse({
            contractVersion: 'zx.execution.v1',
            executionId: claim.executionId,
            attemptId: claim.attemptId,
            routeId: row.route_snapshot.routeId,
            routeVersion: row.route_snapshot.routeVersion,
            runtimeBindingRef: row.capacity_snapshot.runtimeBindingRef,
            adapterId: row.route_snapshot.adapterId,
            adapterVersion: row.route_snapshot.adapterVersion,
            outputs: output.media ? [output.media] : [],
            boundedPromptText: output.promptText,
            provenance: {
                routeId: row.route_snapshot.routeId,
                routeVersion: row.route_snapshot.routeVersion,
                adapterId: row.route_snapshot.adapterId,
                adapterVersion: row.route_snapshot.adapterVersion,
                runtimeBindingRef: row.capacity_snapshot.runtimeBindingRef,
                fixtureVersion: 'fixture-v1',
                startedAt: row.started_at.toISOString(),
                completedAt,
            },
            completedAt,
        });
        await withTransaction(pool, async (client) => {
            const attempt = await client.query(`update execution.execution_attempts
            set status='succeeded', external_run_ref=$4,
                safe_provider_output_ref=$5, completed_at=now(), updated_at=now()
          where id=$1 and execution_id=$2 and lease_token=$3
            and lease_expires_at>now() and status='running'
          returning id`, [
                claim.attemptId,
                claim.executionId,
                claim.leaseToken,
                output.externalRunRef ?? null,
                output.safeProviderOutputRef ?? null,
            ]);
            if (!attempt.rowCount)
                throw new Error('lease lost before success persistence');
            const execution = await client.query(`update execution.executions
            set status='succeeded', result_envelope=$2, error_envelope=null,
                terminal_at=now(), lock_version=lock_version+1, updated_at=now()
          where id=$1 and status='running'
          returning id`, [claim.executionId, result]);
            if (!execution.rowCount)
                throw new Error('execution state changed before success persistence');
            await appendTransition(client, {
                executionId: claim.executionId,
                attemptId: claim.attemptId,
                fromStatus: 'running',
                toStatus: 'succeeded',
                reasonFamily: 'completed',
                actorType: 'worker',
                actorRef: workerId,
                traceId: request.traceId,
            });
        });
        capacityOutcome = 'succeeded';
    }
    catch (error) {
        const failure = toSafeError(error, request.traceId);
        const terminalState = failure.family === 'cancelled'
            ? 'cancelled'
            : failure.family === 'timeout'
                ? 'timed-out'
                : failure.family === 'reconciliation-required' ||
                    failure.family === 'storage-output-failure'
                    ? 'reconciliation-required'
                    : 'failed';
        await withTransaction(pool, async (client) => {
            const attempt = await client.query(`update execution.execution_attempts
            set status=$4, error_family=$5, error_code=$6, error_message=$7,
                completed_at=now(), updated_at=now()
          where id=$1 and execution_id=$2 and lease_token=$3
            and lease_expires_at>now() and status='running'
          returning id`, [
                claim.attemptId,
                claim.executionId,
                claim.leaseToken,
                terminalState,
                failure.family,
                failure.code,
                failure.message,
            ]);
            if (!attempt.rowCount)
                throw new Error('lease lost before failure persistence');
            await client.query(`update execution.executions
            set status=$2, error_envelope=$3, terminal_at=now(),
                lock_version=lock_version+1, updated_at=now()
          where id=$1 and status='running'`, [claim.executionId, terminalState, failure]);
            await appendTransition(client, {
                executionId: claim.executionId,
                attemptId: claim.attemptId,
                fromStatus: 'running',
                toStatus: terminalState,
                reasonFamily: failure.family,
                actorType: 'worker',
                actorRef: workerId,
                traceId: request.traceId,
                safeMetadata: { code: failure.code, retryable: failure.retryable },
            });
            if (terminalState === 'reconciliation-required') {
                await client.query(`insert into execution.execution_reconciliation_cases
            (id, execution_id, attempt_id, case_type, status, reason_family,
             safe_details, detected_at, next_check_at)
           values ($1,$2,$3,'lost-result','open',$4,$5,now(),now())
           on conflict do nothing`, [randomUUID(), claim.executionId, claim.attemptId, failure.family, { code: failure.code }]);
            }
        });
    }
    finally {
        await dependencies.capacity.reportOutcome({ leaseRef: row.capacity_snapshot.leaseRef, outcome: capacityOutcome }, signal);
        await dependencies.capacity.release({ leaseRef: row.capacity_snapshot.leaseRef }, signal);
    }
}
//# sourceMappingURL=lifecycle.js.map