import { randomUUID } from 'node:crypto';
import { validateExecutionRequest } from '../../validation/request.js';
import { withTransaction } from '../../persistence/transaction.js';
import { authenticate, requireScope } from '../auth.js';
function conflict(message) {
    throw Object.assign(new Error(message), { statusCode: 409 });
}
export class MemoryExecutionService {
    rows = new Map();
    async submit(owner, input) {
        const request = validateExecutionRequest(input);
        if (request.ownerApp !== owner) {
            throw Object.assign(new Error('owner mismatch'), { statusCode: 403 });
        }
        for (const row of this.rows.values()) {
            if (row.ownerApp === owner && row.idempotencyKey === request.idempotencyKey) {
                if (row.fingerprint !== request.requestFingerprint)
                    conflict('idempotency conflict');
                return { code: 200, record: row };
            }
        }
        const record = {
            id: randomUUID(),
            ownerApp: owner,
            fingerprint: request.requestFingerprint,
            idempotencyKey: request.idempotencyKey,
            status: 'accepted',
            request,
            cancellationRequested: false,
            retryCount: 0,
            reconciliationOpen: false,
        };
        this.rows.set(record.id, record);
        return { code: 202, record };
    }
    async get(owner, id) {
        const record = this.rows.get(id);
        return record?.ownerApp === owner ? record : null;
    }
    async cancel(owner, id) {
        const record = await this.get(owner, id);
        if (!record)
            return null;
        if (record.cancellationRequested || ['succeeded', 'cancelled'].includes(record.status)) {
            return { code: 200, record: { ...record, cancellationAccepted: false } };
        }
        record.cancellationRequested = true;
        if (!['running', 'reconciliation-required'].includes(record.status))
            record.status = 'cancelled';
        return { code: 202, record: { ...record, cancellationAccepted: true } };
    }
    async retry(owner, id) {
        const record = await this.get(owner, id);
        if (!record)
            return null;
        if (!['failed', 'timed-out'].includes(record.status) || record.retryCount >= 4) {
            conflict('retry conflict');
        }
        record.reconciliationOpen = true;
        record.retryCount += 1;
        record.status = 'queued';
        return { code: 202, record };
    }
    async reconcile(owner, id) {
        const record = await this.get(owner, id);
        if (!record)
            return null;
        if (record.reconciliationOpen)
            return { code: 200, record };
        if (!['running', 'failed', 'timed-out', 'reconciliation-required'].includes(record.status)) {
            conflict('no reconciliable evidence');
        }
        record.reconciliationOpen = true;
        record.status = 'reconciliation-required';
        return { code: 202, record };
    }
}
function mapDatabaseRecord(row) {
    return {
        id: row.id,
        ownerApp: row.owner_app,
        fingerprint: row.request_fingerprint,
        idempotencyKey: row.idempotency_key,
        status: row.status,
        request: row.request_envelope,
        cancellationRequested: Boolean(row.cancellation_requested_at),
        retryCount: Math.max(0, row.current_attempt_number - 1),
        reconciliationOpen: row.reconciliation_open,
        ...(row.result_envelope === null ? {} : { result: row.result_envelope }),
        ...(row.error_envelope === null ? {} : { error: row.error_envelope }),
    };
}
async function selectRecord(database, owner, id, forUpdate = false) {
    const result = await database.query(`select e.id, r.owner_app, r.request_fingerprint, r.idempotency_key,
            e.status, r.request_envelope, e.cancellation_requested_at,
            e.current_attempt_number, e.result_envelope, e.error_envelope,
            exists(
              select 1 from execution.execution_reconciliation_cases c
               where c.execution_id=e.id and c.status in ('open','resolving')
            ) as reconciliation_open
       from execution.executions e
       join execution.execution_requests r on r.id=e.request_id
      where e.id=$1 and r.owner_app=$2
      ${forUpdate ? 'for update of e' : ''}`, [id, owner]);
    return result.rows[0] ?? null;
}
async function appendDatabaseTransition(client, input) {
    await client.query(`insert into execution.execution_status_transitions
      (event_key, execution_id, attempt_id, from_status, to_status,
       reason_family, actor_type, actor_ref, trace_id, safe_metadata)
     values ($1,$2,$3,$4,$5,$6,'api',$7,$8,$9)`, [
        randomUUID(),
        input.executionId,
        input.attemptId ?? null,
        input.fromStatus,
        input.toStatus,
        input.reasonFamily,
        input.actorRef,
        input.traceId,
        input.safeMetadata ?? {},
    ]);
}
export class PostgresExecutionService {
    pool;
    constructor(pool) {
        this.pool = pool;
    }
    async submit(owner, input) {
        const request = validateExecutionRequest(input);
        if (request.ownerApp !== owner) {
            throw Object.assign(new Error('owner mismatch'), { statusCode: 403 });
        }
        return withTransaction(this.pool, async (client) => {
            const existing = await client.query(`select e.id, r.request_fingerprint
           from execution.execution_requests r
           join execution.executions e on e.request_id=r.id
          where r.owner_app=$1 and r.idempotency_key=$2
          for update of r`, [owner, request.idempotencyKey]);
            const duplicate = existing.rows[0];
            if (duplicate) {
                if (duplicate.request_fingerprint !== request.requestFingerprint) {
                    conflict('idempotency conflict');
                }
                const record = await selectRecord(client, owner, duplicate.id);
                if (!record)
                    throw new Error('duplicate execution record is missing');
                return { code: 200, record: mapDatabaseRecord(record) };
            }
            const requestId = randomUUID();
            const executionId = randomUUID();
            await client.query(`insert into execution.execution_requests
          (id, contract_version, owner_app, owner_action_id, owner_project_id,
           idempotency_key, request_fingerprint, operation_type,
           request_envelope, trace_id)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`, [
                requestId,
                request.contractVersion,
                request.ownerApp,
                request.ownerActionId,
                request.ownerProjectId ?? null,
                request.idempotencyKey,
                request.requestFingerprint,
                request.operationType,
                request,
                request.traceId,
            ]);
            await client.query(`insert into execution.executions
          (id, request_id, status, priority, timeout_seconds, max_attempts)
         values ($1,$2,'accepted',$3,$4,$5)`, [
                executionId,
                requestId,
                request.priority,
                request.timeoutPolicy.timeoutSeconds,
                request.retryPolicy.maxAttempts,
            ]);
            await appendDatabaseTransition(client, {
                executionId,
                fromStatus: null,
                toStatus: 'accepted',
                reasonFamily: 'request-accepted',
                actorRef: owner,
                traceId: request.traceId,
                safeMetadata: { ownerActionId: request.ownerActionId },
            });
            const record = await selectRecord(client, owner, executionId);
            if (!record)
                throw new Error('created execution record is missing');
            return { code: 202, record: mapDatabaseRecord(record) };
        });
    }
    async get(owner, id) {
        const record = await selectRecord(this.pool, owner, id);
        return record ? mapDatabaseRecord(record) : null;
    }
    async cancel(owner, id) {
        return withTransaction(this.pool, async (client) => {
            const record = await selectRecord(client, owner, id, true);
            if (!record)
                return null;
            if (record.cancellation_requested_at || ['succeeded', 'cancelled'].includes(record.status)) {
                return {
                    code: 200,
                    record: { ...mapDatabaseRecord(record), cancellationAccepted: false },
                };
            }
            const terminalImmediately = !['running', 'reconciliation-required'].includes(record.status);
            await client.query(`update execution.executions
            set cancellation_requested_at=now(),
                status=case when $2 then 'cancelled' else status end,
                terminal_at=case when $2 then now() else terminal_at end,
                lock_version=lock_version+1, updated_at=now()
          where id=$1`, [id, terminalImmediately]);
            const request = validateExecutionRequest(record.request_envelope);
            if (terminalImmediately) {
                await appendDatabaseTransition(client, {
                    executionId: id,
                    fromStatus: record.status,
                    toStatus: 'cancelled',
                    reasonFamily: 'cancelled',
                    actorRef: owner,
                    traceId: request.traceId,
                });
            }
            const updated = await selectRecord(client, owner, id);
            if (!updated)
                throw new Error('cancelled execution record is missing');
            return {
                code: 202,
                record: { ...mapDatabaseRecord(updated), cancellationAccepted: true },
            };
        });
    }
    async retry(owner, id) {
        return withTransaction(this.pool, async (client) => {
            const record = await selectRecord(client, owner, id, true);
            if (!record)
                return null;
            const policy = await client.query(`select e.max_attempts, e.current_attempt_number, r.trace_id
           from execution.executions e
           join execution.execution_requests r on r.id=e.request_id
          where e.id=$1`, [id]);
            const row = policy.rows[0];
            if (!row ||
                !['failed', 'timed-out'].includes(record.status) ||
                row.current_attempt_number >= row.max_attempts) {
                conflict('retry conflict');
            }
            const nextAttempt = row.current_attempt_number + 1;
            const attemptId = randomUUID();
            await client.query(`insert into execution.execution_attempts
          (id, execution_id, attempt_number, status, started_at)
         values ($1,$2,$3,'queued',now())`, [attemptId, id, nextAttempt]);
            await client.query(`insert into execution.execution_reconciliation_cases
          (id, execution_id, attempt_id, case_type, status, reason_family,
           safe_details, detected_at, next_check_at)
         values ($1,$2,$3,'manual-retry','open','manual-retry',$4,now(),now())`, [randomUUID(), id, attemptId, { priorStatus: record.status }]);
            await client.query(`update execution.executions
            set status='queued', current_attempt_number=$2,
                error_envelope=null, terminal_at=null,
                lock_version=lock_version+1, updated_at=now()
          where id=$1`, [id, nextAttempt]);
            await appendDatabaseTransition(client, {
                executionId: id,
                attemptId,
                fromStatus: record.status,
                toStatus: 'queued',
                reasonFamily: 'manual-retry',
                actorRef: owner,
                traceId: row.trace_id,
                safeMetadata: { attemptNumber: nextAttempt },
            });
            const updated = await selectRecord(client, owner, id);
            if (!updated)
                throw new Error('retried execution record is missing');
            return { code: 202, record: mapDatabaseRecord(updated) };
        });
    }
    async reconcile(owner, id) {
        return withTransaction(this.pool, async (client) => {
            const record = await selectRecord(client, owner, id, true);
            if (!record)
                return null;
            const evidence = await client.query(`select a.id as attempt_id, a.external_run_ref, a.safe_provider_output_ref,
                r.trace_id,
                (select c.id from execution.execution_reconciliation_cases c
                  where c.execution_id=e.id and c.status in ('open','resolving')
                  order by c.detected_at asc limit 1) as open_case_id
           from execution.executions e
           join execution.execution_requests r on r.id=e.request_id
           left join lateral (
             select id, external_run_ref, safe_provider_output_ref
               from execution.execution_attempts
              where execution_id=e.id order by attempt_number desc limit 1
           ) a on true
          where e.id=$1`, [id]);
            const row = evidence.rows[0];
            if (!row)
                conflict('no reconciliable evidence');
            if (row.open_case_id) {
                return { code: 200, record: mapDatabaseRecord(record) };
            }
            if (!['running', 'failed', 'timed-out', 'reconciliation-required'].includes(record.status) &&
                !row.external_run_ref &&
                !row.safe_provider_output_ref) {
                conflict('no reconciliable evidence');
            }
            await client.query(`insert into execution.execution_reconciliation_cases
          (id, execution_id, attempt_id, case_type, status, reason_family,
           safe_details, detected_at, next_check_at)
         values ($1,$2,$3,'operator-request','open','reconciliation-required',$4,now(),now())`, [
                randomUUID(),
                id,
                row.attempt_id,
                {
                    externalRunKnown: Boolean(row.external_run_ref),
                    safeProviderOutputKnown: Boolean(row.safe_provider_output_ref),
                },
            ]);
            if (record.status === 'running') {
                await client.query(`update execution.executions
              set status='reconciliation-required', lock_version=lock_version+1, updated_at=now()
            where id=$1`, [id]);
                await appendDatabaseTransition(client, {
                    executionId: id,
                    attemptId: row.attempt_id,
                    fromStatus: 'running',
                    toStatus: 'reconciliation-required',
                    reasonFamily: 'reconciliation-required',
                    actorRef: owner,
                    traceId: row.trace_id,
                });
            }
            const updated = await selectRecord(client, owner, id);
            if (!updated)
                throw new Error('reconciliation execution record is missing');
            return { code: 202, record: mapDatabaseRecord(updated) };
        });
    }
}
class FixedWindowRateLimiter {
    windows = new Map();
    consume(key, limit, durationMilliseconds) {
        const now = Date.now();
        const existing = this.windows.get(key);
        if (!existing || now - existing.startedAt >= durationMilliseconds) {
            this.windows.set(key, { startedAt: now, count: 1 });
            return;
        }
        if (existing.count >= limit) {
            throw Object.assign(new Error('rate limit exceeded'), { statusCode: 429 });
        }
        existing.count += 1;
    }
}
async function principal(request, verify, scope) {
    const authenticated = await authenticate(request, verify);
    requireScope(authenticated, scope);
    return authenticated;
}
export async function executionRoutes(app, options) {
    const limiter = new FixedWindowRateLimiter();
    app.post('/internal/v1/executions', async (request, reply) => {
        const actor = await principal(request, options.verify, 'zx.executions.submit');
        limiter.consume(`${actor.ownerApp}:submit`, 20, 60_000);
        const result = await options.service.submit(actor.ownerApp, request.body);
        return reply.code(result.code).send(result.record);
    });
    app.get('/internal/v1/executions/:executionId', async (request, reply) => {
        const actor = await principal(request, options.verify, 'zx.executions.read');
        limiter.consume(`${actor.ownerApp}:read`, 120, 60_000);
        const id = request.params.executionId;
        const record = await options.service.get(actor.ownerApp, id);
        return record ?? reply.code(404).send({ error: 'not found' });
    });
    for (const [action, scope] of [
        ['cancel', 'zx.executions.cancel'],
        ['retry', 'zx.executions.retry'],
        ['reconcile', 'zx.executions.reconcile'],
    ]) {
        app.post(`/internal/v1/executions/:executionId/${action}`, async (request, reply) => {
            const actor = await principal(request, options.verify, scope);
            limiter.consume(`${actor.ownerApp}:${action}`, 30, 60_000);
            const id = request.params.executionId;
            const result = await options.service[action](actor.ownerApp, id);
            return result
                ? reply.code(result.code).send(result.record)
                : reply.code(404).send({ error: 'not found' });
        });
    }
}
//# sourceMappingURL=executions.js.map