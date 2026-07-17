import { randomUUID } from 'node:crypto';
export class AttemptsRepository {
    db;
    constructor(db) {
        this.db = db;
    }
    async create(executionId, attemptNumber) { const id = randomUUID(); await this.db.query('insert into execution.execution_attempts(id,execution_id,attempt_number,status,started_at) values($1,$2,$3,$4,now())', [id, executionId, attemptNumber, 'created']); return id; }
    async complete(id, leaseToken, status) { const q = await this.db.query('update execution.execution_attempts set status=$3,completed_at=now(),updated_at=now() where id=$1 and lease_token=$2 and lease_expires_at>now() returning id', [id, leaseToken, status]); if (!q.rowCount)
        throw new Error('lease lost'); }
}
//# sourceMappingURL=attempts.js.map