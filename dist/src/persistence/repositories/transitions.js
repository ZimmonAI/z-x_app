import { randomUUID } from 'node:crypto';
export class TransitionsRepository {
    db;
    constructor(db) {
        this.db = db;
    }
    async append(executionId, fromStatus, toStatus, reasonFamily, actorType, traceId, safeMetadata = {}) { await this.db.query('insert into execution.execution_status_transitions(event_key,execution_id,from_status,to_status,reason_family,actor_type,trace_id,safe_metadata) values($1,$2,$3,$4,$5,$6,$7,$8)', [randomUUID(), executionId, fromStatus, toStatus, reasonFamily, actorType, traceId, safeMetadata]); }
}
//# sourceMappingURL=transitions.js.map