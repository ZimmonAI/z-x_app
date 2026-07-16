import { randomUUID } from 'node:crypto';
import { ExecutionsRepository } from '../../src/persistence/repositories/executions.js';
import { claimNext } from '../../src/worker/claim.js';
import { recoverExpiredLeases } from '../../src/worker/reconciliation.js';
import { validRequest } from '../unit/test-request.js';
import { reset, testPool } from './db-helper.js';

test('expired pre-dispatch lease returns work to the queue', async () => {
  const pool = testPool();
  await reset(pool);
  const submitted = await new ExecutionsRepository(pool).submit(validRequest() as never);
  const executionId = submitted.id;
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
    [randomUUID(), executionId],
  );
  const claim = await claimNext(pool, 'worker', 60);
  expect(claim).not.toBeNull();
  await pool.query(
    `update execution.execution_attempts
        set lease_expires_at=now()-interval '1 second'
      where id=$1`,
    [claim!.attemptId],
  );
  expect(await recoverExpiredLeases(pool)).toBe(1);
  const state = await pool.query('select status from execution.executions where id=$1', [
    claim!.executionId,
  ]);
  expect(state.rows[0].status).toBe('queued');
  await pool.end();
});
