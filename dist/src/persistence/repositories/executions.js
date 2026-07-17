import { randomUUID } from 'node:crypto';
export class ExecutionsRepository {
    db;
    constructor(db) {
        this.db = db;
    }
    async submit(r) { const existing = await this.db.query('select r.request_fingerprint,e.id,e.status from execution.execution_requests r join execution.executions e on e.request_id=r.id where r.owner_app=$1 and r.idempotency_key=$2', [r.ownerApp, r.idempotencyKey]); if (existing.rowCount) {
        const row = existing.rows[0];
        if (row.request_fingerprint !== r.requestFingerprint)
            return { kind: 'conflict' };
        return { kind: 'duplicate', id: row.id, status: row.status };
    } const reqId = randomUUID(), id = randomUUID(); await this.db.query('insert into execution.execution_requests(id,contract_version,owner_app,owner_action_id,owner_project_id,idempotency_key,request_fingerprint,operation_type,request_envelope,trace_id) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)', [reqId, r.contractVersion, r.ownerApp, r.ownerActionId, r.ownerProjectId ?? null, r.idempotencyKey, r.requestFingerprint, r.operationType, r, r.traceId]); await this.db.query('insert into execution.executions(id,request_id,status,priority,timeout_seconds,max_attempts) values($1,$2,$3,$4,$5,$6)', [id, reqId, 'accepted', r.priority, r.timeoutPolicy.timeoutSeconds, r.retryPolicy.maxAttempts]); return { kind: 'created', id, status: 'accepted' }; }
    async get(id, ownerApp) { const q = await this.db.query('select e.* from execution.executions e join execution.execution_requests r on r.id=e.request_id where e.id=$1 and r.owner_app=$2', [id, ownerApp]); return q.rows[0] ?? null; }
}
//# sourceMappingURL=executions.js.map