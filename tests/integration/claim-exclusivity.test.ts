import { randomUUID } from 'node:crypto';
import { AutoHubFixtureV1 } from '../../fixtures/v1/auto-hub.js';
import { ZAccountFixtureV1 } from '../../fixtures/v1/z-account.js';
import { ZProviderFixtureV1 } from '../../fixtures/v1/z-provider.js';
import { ZStorageFixtureV1 } from '../../fixtures/v1/z-s.js';
import { PostgresExecutionService } from '../../src/api/routes/executions.js';
import { ExecutionsRepository } from '../../src/persistence/repositories/executions.js';
import { claimNext } from '../../src/worker/claim.js';
import { prepareManualRetry } from '../../src/worker/reconciliation.js';
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

test('manual retry is prepared before it becomes claimable', async () => {
  const pool = testPool();
  await reset(pool);
  const repository = new ExecutionsRepository(pool);
  const submitted = await repository.submit(validRequest() as never);
  await pool.query(
    `update execution.executions
        set status='failed', terminal_at=now()
      where id=$1`,
    [submitted.id],
  );

  const service = new PostgresExecutionService(pool);
  const retry = await service.retry('video-maker', submitted.id);
  expect(retry?.code).toBe(202);
  expect(await claimNext(pool, 'worker-before-preparation')).toBeNull();

  expect(
    await prepareManualRetry(pool, 'retry-preparer', 60, {
      routes: new ZProviderFixtureV1(),
      capacity: new ZAccountFixtureV1(),
      autoHub: new AutoHubFixtureV1(),
      storage: new ZStorageFixtureV1(),
    }),
  ).toBe(true);
  expect(await claimNext(pool, 'worker-after-preparation')).not.toBeNull();
  await pool.end();
});
