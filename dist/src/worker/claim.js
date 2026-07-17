import { randomUUID } from 'node:crypto';
import { withTransaction } from '../persistence/transaction.js';
const ALL_OPERATIONS = [
    'image_prompt.prepare.v1',
    'image.generate.v1',
    'scene_video_prompt.prepare.v1',
    'scene_video.generate.v1',
];
export async function claimNext(pool, workerId, leaseSeconds = 60, enabledOperations = ALL_OPERATIONS) {
    if (enabledOperations.length === 0)
        return null;
    return withTransaction(pool, async (client) => {
        const selected = await client.query(`select e.id as execution_id, a.id as attempt_id, r.trace_id
         from execution.executions e
         join execution.execution_requests r on r.id=e.request_id
         join execution.execution_attempts a
           on a.execution_id=e.id and a.attempt_number=e.current_attempt_number
        where e.status='queued' and a.status='queued'
          and r.operation_type=any($1::text[])
          and a.route_snapshot is not null and a.capacity_snapshot is not null
          and (a.lease_expires_at is null or a.lease_expires_at<=now())
        order by e.priority desc, e.created_at asc, e.id asc
        for update of e, a skip locked
        limit 1`, [enabledOperations]);
        const row = selected.rows[0];
        if (!row)
            return null;
        const leaseToken = randomUUID();
        const attempt = await client.query(`update execution.execution_attempts
          set status='running', worker_id=$2, lease_token=$3,
              lease_expires_at=now()+make_interval(secs=>$4),
              heartbeat_at=now(), updated_at=now()
        where id=$1 and status='queued'
          and (lease_expires_at is null or lease_expires_at<=now())
        returning id`, [row.attempt_id, workerId, leaseToken, leaseSeconds]);
        if (!attempt.rowCount)
            return null;
        const execution = await client.query(`update execution.executions
          set status='running', lock_version=lock_version+1, updated_at=now()
        where id=$1 and status='queued'
        returning id`, [row.execution_id]);
        if (!execution.rowCount)
            throw new Error('execution claim state changed');
        await client.query(`insert into execution.execution_status_transitions
        (event_key, execution_id, attempt_id, from_status, to_status,
         reason_family, actor_type, actor_ref, trace_id, safe_metadata)
       values ($1,$2,$3,'queued','running','claimed','worker',$4,$5,'{}'::jsonb)`, [randomUUID(), row.execution_id, row.attempt_id, workerId, row.trace_id]);
        return {
            executionId: row.execution_id,
            attemptId: row.attempt_id,
            leaseToken,
        };
    });
}
//# sourceMappingURL=claim.js.map