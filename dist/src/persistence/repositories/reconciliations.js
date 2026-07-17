import { randomUUID } from 'node:crypto';
export class ReconciliationsRepository {
    db;
    constructor(db) {
        this.db = db;
    }
    async open(executionId, attemptId, caseType, reasonFamily, details = {}) { const id = randomUUID(); const q = await this.db.query('insert into execution.execution_reconciliation_cases(id,execution_id,attempt_id,case_type,status,reason_family,safe_details,detected_at,next_check_at) values($1,$2,$3,$4,$5,$6,$7,now(),now()) on conflict do nothing returning id', [id, executionId, attemptId, caseType, 'open', reasonFamily, details]); return q.rows[0]?.id ?? null; }
}
//# sourceMappingURL=reconciliations.js.map