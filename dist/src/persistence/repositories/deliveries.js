import { randomUUID } from 'node:crypto';
export class DeliveriesRepository {
    db;
    constructor(db) {
        this.db = db;
    }
    async ensure(executionId, kind, correlation) { await this.db.query('insert into execution.execution_delivery_attempts(id,execution_id,delivery_kind,correlation_key,status,next_attempt_at) values($1,$2,$3,$4,$5,now()) on conflict(execution_id,delivery_kind,correlation_key) do nothing', [randomUUID(), executionId, kind, correlation, 'pending']); }
}
//# sourceMappingURL=deliveries.js.map