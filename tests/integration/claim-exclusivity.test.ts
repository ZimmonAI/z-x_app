import { randomUUID } from 'node:crypto';
import { ExecutionsRepository } from '../../src/persistence/repositories/executions.js';
import { claimNext } from '../../src/worker/claim.js';
import { validRequest } from '../unit/test-request.js';
import { reset, testPool } from './db-helper.js';

test('two workers cannot claim one prepared execution', async () => {
  const pool = testPool();
  await reset(pool);
  const submitted = await new ExecutionsRepository(pool).submit(validRequest() as never);
  const executionId = submitted.id;
  const attemptId = randomUUID();
  await pool.query(
    `update execution.executions
        set status='queued', current_attempt_number=1
      where id=$1`,
    [executionId],
  );
  await pool.query(
    `insert into execution.execution_attempts
      (id, execution_id, attempt_number, status, route_snapshot,
       capacity_snapshot, started_at)
     values ($1,$2,1,'queued','{}'::jsonb,'{}'::jsonb,now())`,
    [attemptId, executionId],
  );

  const [first, second] = await Promise.all([
    claimNext(pool, 'worker-1'),
    claimNext(pool, 'worker-2'),
  ]);
  expect([first, second].filter(Boolean)).toHaveLength(1);
  expect([first, second].find(Boolean)?.attemptId).toBe(attemptId);
  await pool.end();
});
