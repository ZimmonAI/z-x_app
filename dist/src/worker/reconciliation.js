import { randomUUID } from 'node:crypto';
import { fixtureScenario } from '../adapters/types.js';
import { parseOutputReconciliationV1 } from '../contracts/v1/dependencies.js';
import { SafeExecutionError } from '../contracts/v1/error.js';
import { ExecutionResultV1Schema } from '../contracts/v1/result.js';
import { withTransaction } from '../persistence/transaction.js';
import { validateGeneratedMedia } from '../validation/output.js';
import { validateExecutionRequest } from '../validation/request.js';
function boundedSeconds(value, fallback) {
    if (!Number.isFinite(value))
        return fallback;
    return Math.min(300, Math.max(1, Math.trunc(value)));
}
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
function storageLookupError(error) {
    if (error instanceof SafeExecutionError) {
        return { code: error.safe.code, retryable: true };
    }
    return { code: 'ZX_STORAGE_RECONCILIATION_LOOKUP_FAILED', retryable: true };
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
async function claimStorageCompletion(pool, leaseSeconds) {
    const claimedUntil = new Date(Date.now() + boundedSeconds(leaseSeconds, 60) * 1000);
    return withTransaction(pool, async (client) => {
        const selected = await client.query(`select e.id as execution_id, a.id as attempt_id, c.id as case_id,
              r.request_envelope, a.route_snapshot, a.capacity_snapshot,
              a.started_at, a.output_authorization_ref, a.safe_provider_output_ref
         from execution.executions e
         join execution.execution_requests r on r.id=e.request_id
         join execution.execution_attempts a
           on a.execution_id=e.id and a.attempt_number=e.current_attempt_number
         join execution.execution_reconciliation_cases c
           on c.execution_id=e.id and c.attempt_id=a.id
        where e.status='reconciliation-required'
          and a.status='reconciliation-required'
          and c.case_type in ('lost-result','storage-completion')
          and c.status in ('open','resolving')
          and c.next_check_at<=now()
          and a.output_authorization_ref is not null
          and a.safe_provider_output_ref is not null
          and a.route_snapshot is not null
          and a.capacity_snapshot is not null
        order by c.next_check_at asc, c.detected_at asc, e.created_at asc, e.id asc
        for update of e, a, c skip locked
        limit 1`);
        const row = selected.rows[0];
        if (!row)
            return null;
        const claimed = await client.query(`update execution.execution_reconciliation_cases
          set status='resolving', reason_family='storage-completion-reconciliation',
              next_check_at=$2, updated_at=now()
        where id=$1 and status in ('open','resolving') and next_check_at<=now()
        returning id`, [row.case_id, claimedUntil]);
        if (!claimed.rowCount)
            return null;
        return {
            executionId: row.execution_id,
            attemptId: row.attempt_id,
            caseId: row.case_id,
            claimedUntil,
            request: validateExecutionRequest(row.request_envelope),
            route: row.route_snapshot,
            capacity: row.capacity_snapshot,
            startedAt: row.started_at,
            authorizationRef: row.output_authorization_ref,
            safeProviderOutputRef: row.safe_provider_output_ref,
        };
    });
}
function validateReconciledStorageResult(expectedMimeType, result) {
    if (result.mimeType !== expectedMimeType) {
        throw new Error('reconciled storage result MIME does not match the original request');
    }
    if (result.width === undefined || result.height === undefined) {
        throw new Error('reconciled storage result is missing media dimensions');
    }
    const kind = result.mimeType.startsWith('image/')
        ? 'image'
        : result.mimeType.startsWith('video/')
            ? 'video'
            : undefined;
    if (!kind)
        throw new Error('reconciled storage result is not image or video media');
    validateGeneratedMedia(kind, {
        mimeType: result.mimeType,
        sizeBytes: result.sizeBytes,
        width: result.width,
        height: result.height,
        checksumSha256: result.checksumSha256,
        storageIdentity: result.storageIdentity,
        ...(result.durationSeconds === undefined ? {} : { durationSeconds: result.durationSeconds }),
    });
    return result;
}
function buildExecutionResult(claim, storageResult) {
    const completedAt = new Date().toISOString();
    return ExecutionResultV1Schema.parse({
        contractVersion: 'zx.execution.v1',
        executionId: claim.executionId,
        attemptId: claim.attemptId,
        routeId: claim.route.routeId,
        routeVersion: claim.route.routeVersion,
        runtimeBindingRef: claim.capacity.runtimeBindingRef,
        adapterId: claim.route.adapterId,
        adapterVersion: claim.route.adapterVersion,
        outputs: [validateReconciledStorageResult(claim.request.requestedOutputType, storageResult)],
        provenance: {
            routeId: claim.route.routeId,
            routeVersion: claim.route.routeVersion,
            adapterId: claim.route.adapterId,
            adapterVersion: claim.route.adapterVersion,
            runtimeBindingRef: claim.capacity.runtimeBindingRef,
            ...(claim.route.invocationMode === 'fixture' ? { fixtureVersion: 'fixture-v1' } : {}),
            startedAt: claim.startedAt.toISOString(),
            completedAt,
        },
        completedAt,
    });
}
async function reopenStorageCase(pool, claim, retryAfterSeconds, reasonFamily, safeDetails) {
    const nextCheckAt = new Date(Date.now() + boundedSeconds(retryAfterSeconds, 30) * 1000);
    await pool.query(`update execution.execution_reconciliation_cases
        set status='open', reason_family=$5, safe_details=$6,
            next_check_at=$7, updated_at=now()
      where id=$1 and execution_id=$2 and attempt_id=$3
        and status='resolving' and next_check_at=$4`, [
        claim.caseId,
        claim.executionId,
        claim.attemptId,
        claim.claimedUntil,
        reasonFamily,
        safeDetails,
        nextCheckAt,
    ]);
}
async function finalizeCompletedStorageResult(pool, claim, result, workerId) {
    await withTransaction(pool, async (client) => {
        const selected = await client.query(`select e.status as execution_status, a.status as attempt_status,
              c.status as case_status, c.next_check_at, e.result_envelope
         from execution.executions e
         join execution.execution_attempts a on a.id=$2 and a.execution_id=e.id
         join execution.execution_reconciliation_cases c
           on c.id=$3 and c.execution_id=e.id and c.attempt_id=a.id
        where e.id=$1
        for update of e, a, c`, [claim.executionId, claim.attemptId, claim.caseId]);
        const row = selected.rows[0];
        if (!row)
            throw new Error('storage reconciliation state disappeared');
        if (row.execution_status === 'succeeded' &&
            row.attempt_status === 'succeeded' &&
            row.case_status === 'resolved') {
            const existing = ExecutionResultV1Schema.safeParse(row.result_envelope);
            if (!existing.success || JSON.stringify(existing.data) !== JSON.stringify(result)) {
                await client.query(`update execution.execution_reconciliation_cases
              set safe_details=safe_details || $2::jsonb, updated_at=now()
            where id=$1`, [claim.caseId, { conflict: true, code: 'ZX_STORAGE_RESULT_CONFLICT' }]);
            }
            return;
        }
        if (row.execution_status !== 'reconciliation-required' ||
            row.attempt_status !== 'reconciliation-required' ||
            row.case_status !== 'resolving' ||
            row.next_check_at.getTime() !== claim.claimedUntil.getTime()) {
            return;
        }
        const attempt = await client.query(`update execution.execution_attempts
          set status='succeeded', error_family=null, error_code=null, error_message=null,
              completed_at=now(), worker_id=null, lease_token=null,
              lease_expires_at=null, heartbeat_at=null, updated_at=now()
        where id=$1 and execution_id=$2 and status='reconciliation-required'
          and output_authorization_ref=$3 and safe_provider_output_ref=$4
        returning id`, [
            claim.attemptId,
            claim.executionId,
            claim.authorizationRef,
            claim.safeProviderOutputRef,
        ]);
        if (!attempt.rowCount)
            throw new Error('storage reconciliation attempt state changed');
        const execution = await client.query(`update execution.executions
          set status='succeeded', result_envelope=$2, error_envelope=null,
              terminal_at=now(), lock_version=lock_version+1, updated_at=now()
        where id=$1 and status='reconciliation-required'
        returning id`, [claim.executionId, result]);
        if (!execution.rowCount)
            throw new Error('storage reconciliation execution state changed');
        await client.query(`insert into execution.execution_status_transitions
        (event_key, execution_id, attempt_id, from_status, to_status,
         reason_family, actor_type, actor_ref, trace_id, safe_metadata)
       values ($1,$2,$3,'reconciliation-required','succeeded',
               'storage-completion-reconciled','worker',$4,$5,'{}'::jsonb)`, [randomUUID(), claim.executionId, claim.attemptId, workerId, claim.request.traceId]);
        const reconciliationCase = await client.query(`update execution.execution_reconciliation_cases
          set status='resolved', reason_family='storage-completion-reconciliation',
              safe_details=$5, resolved_at=now(),
              resolution_code='storage-result-confirmed', updated_at=now()
        where id=$1 and execution_id=$2 and attempt_id=$3
          and status='resolving' and next_check_at=$4
        returning id`, [
            claim.caseId,
            claim.executionId,
            claim.attemptId,
            claim.claimedUntil,
            { resultConfirmed: true },
        ]);
        if (!reconciliationCase.rowCount) {
            throw new Error('storage reconciliation case claim changed before completion');
        }
    });
}
async function finalizeTerminalStorageFailure(pool, claim, errorCode, workerId) {
    const error = {
        family: 'storage-output-failure',
        code: errorCode,
        message: 'storage completion was confirmed failed',
        retryable: false,
        traceId: claim.request.traceId,
    };
    await withTransaction(pool, async (client) => {
        const selected = await client.query(`select e.status as execution_status, a.status as attempt_status,
              c.status as case_status, c.next_check_at
         from execution.executions e
         join execution.execution_attempts a on a.id=$2 and a.execution_id=e.id
         join execution.execution_reconciliation_cases c
           on c.id=$3 and c.execution_id=e.id and c.attempt_id=a.id
        where e.id=$1
        for update of e, a, c`, [claim.executionId, claim.attemptId, claim.caseId]);
        const row = selected.rows[0];
        if (!row)
            throw new Error('storage reconciliation state disappeared');
        if (row.execution_status !== 'reconciliation-required' ||
            row.attempt_status !== 'reconciliation-required' ||
            row.case_status !== 'resolving' ||
            row.next_check_at.getTime() !== claim.claimedUntil.getTime()) {
            return;
        }
        const attempt = await client.query(`update execution.execution_attempts
          set status='failed', error_family='storage-output-failure',
              error_code=$3, error_message=$4, completed_at=now(),
              worker_id=null, lease_token=null, lease_expires_at=null,
              heartbeat_at=null, updated_at=now()
        where id=$1 and execution_id=$2 and status='reconciliation-required'
          and output_authorization_ref=$5 and safe_provider_output_ref=$6
        returning id`, [
            claim.attemptId,
            claim.executionId,
            error.code,
            error.message,
            claim.authorizationRef,
            claim.safeProviderOutputRef,
        ]);
        if (!attempt.rowCount)
            throw new Error('storage reconciliation attempt state changed');
        const execution = await client.query(`update execution.executions
          set status='failed', result_envelope=null, error_envelope=$2,
              terminal_at=now(), lock_version=lock_version+1, updated_at=now()
        where id=$1 and status='reconciliation-required'
        returning id`, [claim.executionId, error]);
        if (!execution.rowCount)
            throw new Error('storage reconciliation execution state changed');
        await client.query(`insert into execution.execution_status_transitions
        (event_key, execution_id, attempt_id, from_status, to_status,
         reason_family, actor_type, actor_ref, trace_id, safe_metadata)
       values ($1,$2,$3,'reconciliation-required','failed',
               'storage-output-failure','worker',$4,$5,$6)`, [
            randomUUID(),
            claim.executionId,
            claim.attemptId,
            workerId,
            claim.request.traceId,
            { code: error.code, retryable: false },
        ]);
        const reconciliationCase = await client.query(`update execution.execution_reconciliation_cases
          set status='resolved', reason_family='storage-output-failure',
              safe_details=$5, resolved_at=now(),
              resolution_code='storage-completion-terminal-failure', updated_at=now()
        where id=$1 and execution_id=$2 and attempt_id=$3
          and status='resolving' and next_check_at=$4
        returning id`, [
            claim.caseId,
            claim.executionId,
            claim.attemptId,
            claim.claimedUntil,
            { code: error.code, retryable: false },
        ]);
        if (!reconciliationCase.rowCount) {
            throw new Error('storage reconciliation case claim changed before terminal failure');
        }
    });
}
export async function reconcileNextStorageCompletion(pool, workerId, leaseSeconds, dependencies, signal = new AbortController().signal) {
    const claim = await claimStorageCompletion(pool, leaseSeconds);
    if (!claim)
        return false;
    try {
        const reconciliation = parseOutputReconciliationV1(await dependencies.storage.reconcileOutput({
            executionId: claim.executionId,
            attemptId: claim.attemptId,
            authorizationRef: claim.authorizationRef,
            safeProviderOutputRef: claim.safeProviderOutputRef,
            mimeType: claim.request.requestedOutputType,
            fixtureScenario: fixtureScenario(claim.request),
        }, signal));
        if (reconciliation.status === 'completed') {
            await finalizeCompletedStorageResult(pool, claim, buildExecutionResult(claim, reconciliation.result), workerId);
            return true;
        }
        if (reconciliation.status === 'pending') {
            await reopenStorageCase(pool, claim, reconciliation.retryAfterSeconds, 'storage-output-pending', { retryAfterSeconds: reconciliation.retryAfterSeconds });
            return true;
        }
        if (reconciliation.retryable) {
            await reopenStorageCase(pool, claim, boundedSeconds(leaseSeconds, 30), 'storage-output-failure', {
                code: reconciliation.errorCode,
                retryable: true,
            });
            return true;
        }
        await finalizeTerminalStorageFailure(pool, claim, reconciliation.errorCode, workerId);
        return true;
    }
    catch (error) {
        const failure = storageLookupError(error);
        await reopenStorageCase(pool, claim, boundedSeconds(leaseSeconds, 30), 'storage-output-failure', failure);
        return true;
    }
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
              a.external_run_ref, a.output_authorization_ref,
              a.safe_provider_output_ref, r.trace_id
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
                {
                    externalRunKnown: Boolean(row.external_run_ref),
                    outputAuthorizationKnown: Boolean(row.output_authorization_ref),
                    safeProviderOutputKnown: Boolean(row.safe_provider_output_ref),
                },
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
                        outputAuthorizationKnown: Boolean(row.output_authorization_ref),
                        safeProviderOutputKnown: Boolean(row.safe_provider_output_ref),
                    },
                ]);
            }
        }
        return expired.rowCount ?? 0;
    });
}
//# sourceMappingURL=reconciliation.js.map