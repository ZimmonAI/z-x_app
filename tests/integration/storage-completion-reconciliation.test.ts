import { AutoHubFixtureV1 } from '../../fixtures/v1/auto-hub.js';
import { ZAccountFixtureV1 } from '../../fixtures/v1/z-account.js';
import { ZProviderFixtureV1 } from '../../fixtures/v1/z-provider.js';
import { ZStorageFixtureV1 } from '../../fixtures/v1/z-s.js';
import type {
  CompleteOutputV1,
  OutputReconciliationV1,
  ReconcileOutputV1,
  StorageResultV1,
} from '../../src/contracts/v1/dependencies.js';
import { SafeExecutionError } from '../../src/contracts/v1/error.js';
import { ExecutionResultV1Schema } from '../../src/contracts/v1/result.js';
import { ExecutionsRepository } from '../../src/persistence/repositories/executions.js';
import { claimNext } from '../../src/worker/claim.js';
import {
  completeClaimedExecution,
  prepareNextExecution,
  type FixtureDependencies,
} from '../../src/worker/lifecycle.js';
import { reconcileNextStorageCompletion } from '../../src/worker/reconciliation.js';
import { validRequest } from '../unit/test-request.js';
import { reset, testPool } from './db-helper.js';

class RecoveringStorage extends ZStorageFixtureV1 {
  readonly reconciliationInputs: ReconcileOutputV1[] = [];

  constructor(private readonly delayMilliseconds = 0) {
    super();
  }

  override async completeOrIngestOutput(
    _input: CompleteOutputV1,
    _signal: AbortSignal,
  ): Promise<StorageResultV1> {
    throw new SafeExecutionError({
      family: 'storage-output-failure',
      code: 'ZX_STORAGE_COMPLETION_UNCERTAIN',
      message: 'fixture storage completion is uncertain',
      retryable: true,
      traceId: 'fixture',
    });
  }

  override async reconcileOutput(
    input: ReconcileOutputV1,
    signal: AbortSignal,
  ): Promise<OutputReconciliationV1> {
    this.reconciliationInputs.push(input);
    if (this.delayMilliseconds > 0) {
      await new Promise((resolve) => setTimeout(resolve, this.delayMilliseconds));
    }
    return super.reconcileOutput({ ...input, fixtureScenario: 'success' }, signal);
  }
}

function imageStorageRequest() {
  return {
    ...validRequest('image.generate.v1'),
    safeScalarInputs: { prompt: 'cinematic sunrise' },
    requestedOutputType: 'image/png',
    ownerStorageAccess: {
      contractVersion: 'zx.owner-storage-access.v1',
      pendingResourceId: 'pending-image-reconciliation',
      outputWriteGrantRef: 'write-grant-image-reconciliation',
      artifactKind: 'image',
      acceptedMimeTypes: ['image/png'],
      maxBytes: 1048576,
    },
    storageOutput: {
      contractVersion: 'zx.storage-output.v1',
      mode: 'post-run-ingest',
      artifactKind: 'image',
      acceptedMimeTypes: ['image/png'],
      storageProfileRef: 'zs-profile:fixture.default',
      maxBytes: 1048576,
    },
  };
}

async function createUncertainStorageExecution(
  pool: ReturnType<typeof testPool>,
  storage: RecoveringStorage,
): Promise<{
  dependencies: FixtureDependencies;
  executionId: string;
  attemptId: string;
  caseId: string;
  authorizationRef: string;
  safeProviderOutputRef: string;
}> {
  const dependencies: FixtureDependencies = {
    routes: new ZProviderFixtureV1(),
    capacity: new ZAccountFixtureV1(),
    autoHub: new AutoHubFixtureV1(),
    storage,
  };
  const submitted = await new ExecutionsRepository(pool).submit(imageStorageRequest() as never);
  if (submitted.kind !== 'created') throw new Error('expected created execution');
  await prepareNextExecution(pool, 'worker-prepare', 60, dependencies);
  const claim = await claimNext(pool, 'worker-run');
  if (!claim) throw new Error('expected execution claim');
  await completeClaimedExecution(pool, claim, 'worker-run', dependencies);

  const state = await pool.query<{
    execution_status: string;
    attempt_status: string;
    output_authorization_ref: string | null;
    safe_provider_output_ref: string | null;
    case_id: string;
    case_status: string;
    next_check_at: Date;
  }>(
    `select e.status as execution_status, a.status as attempt_status,
            a.output_authorization_ref, a.safe_provider_output_ref,
            c.id as case_id, c.status as case_status, c.next_check_at
       from execution.executions e
       join execution.execution_attempts a on a.id=$2 and a.execution_id=e.id
       join execution.execution_reconciliation_cases c
         on c.execution_id=e.id and c.attempt_id=a.id
      where e.id=$1`,
    [claim.executionId, claim.attemptId],
  );
  const row = state.rows[0];
  expect(row?.execution_status).toBe('reconciliation-required');
  expect(row?.attempt_status).toBe('reconciliation-required');
  expect(row?.case_status).toBe('open');
  expect(row?.next_check_at.getTime()).toBeLessThanOrEqual(Date.now());
  if (!row?.output_authorization_ref || !row.safe_provider_output_ref || !row.case_id) {
    throw new Error('expected persisted storage reconciliation references');
  }
  return {
    dependencies,
    executionId: claim.executionId,
    attemptId: claim.attemptId,
    caseId: row.case_id,
    authorizationRef: row.output_authorization_ref,
    safeProviderOutputRef: row.safe_provider_output_ref,
  };
}

test('completed storage reconciliation finalizes the original attempt without re-execution', async () => {
  const pool = testPool();
  await reset(pool);
  const storage = new RecoveringStorage();
  const state = await createUncertainStorageExecution(pool, storage);

  expect(await reconcileNextStorageCompletion(pool, 'worker-reconcile', state.dependencies)).toBe(true);

  const completed = await pool.query<{
    execution_status: string;
    attempt_status: string;
    case_status: string;
    resolution_code: string | null;
    result_envelope: unknown;
    output_authorization_ref: string | null;
    safe_provider_output_ref: string | null;
    attempt_count: number;
  }>(
    `select e.status as execution_status, a.status as attempt_status,
            c.status as case_status, c.resolution_code, e.result_envelope,
            a.output_authorization_ref, a.safe_provider_output_ref,
            (select count(*)::int from execution.execution_attempts where execution_id=e.id) attempt_count
       from execution.executions e
       join execution.execution_attempts a on a.id=$2 and a.execution_id=e.id
       join execution.execution_reconciliation_cases c on c.id=$3
      where e.id=$1`,
    [state.executionId, state.attemptId, state.caseId],
  );
  const row = completed.rows[0];
  expect(row?.execution_status).toBe('succeeded');
  expect(row?.attempt_status).toBe('succeeded');
  expect(row?.case_status).toBe('resolved');
  expect(row?.resolution_code).toBe('ZX_STORAGE_RECONCILED_COMPLETED');
  expect(row?.attempt_count).toBe(1);
  expect(row?.output_authorization_ref).toBe(state.authorizationRef);
  expect(row?.safe_provider_output_ref).toBe(state.safeProviderOutputRef);
  expect(ExecutionResultV1Schema.parse(row?.result_envelope).status).toBe('succeeded');
  expect(storage.reconciliationInputs).toHaveLength(1);
  expect(storage.reconciliationInputs[0]).toMatchObject({
    attemptId: state.attemptId,
    authorizationRef: state.authorizationRef,
    safeProviderOutputRef: state.safeProviderOutputRef,
  });
  await pool.end();
});

test('two workers cannot finalize the same storage reconciliation case twice', async () => {
  const pool = testPool();
  await reset(pool);
  const storage = new RecoveringStorage(25);
  const state = await createUncertainStorageExecution(pool, storage);

  const outcomes = await Promise.all([
    reconcileNextStorageCompletion(pool, 'worker-reconcile-a', state.dependencies),
    reconcileNextStorageCompletion(pool, 'worker-reconcile-b', state.dependencies),
  ]);
  expect(outcomes.filter(Boolean)).toHaveLength(1);
  expect(storage.reconciliationInputs).toHaveLength(1);
  expect(
    (
      await pool.query<{ count: number }>(
        `select count(*)::int count
           from execution.execution_status_transitions
          where execution_id=$1 and to_status='succeeded'`,
        [state.executionId],
      )
    ).rows[0]?.count,
  ).toBe(1);
  await pool.end();
});

test('a stale resolving claim is reclaimable after its deadline', async () => {
  const pool = testPool();
  await reset(pool);
  const storage = new RecoveringStorage();
  const state = await createUncertainStorageExecution(pool, storage);
  await pool.query(
    `update execution.execution_reconciliation_cases
        set status='resolving', next_check_at=now() - interval '1 second'
      where id=$1`,
    [state.caseId],
  );

  expect(await reconcileNextStorageCompletion(pool, 'worker-reconcile', state.dependencies)).toBe(true);
  expect(storage.reconciliationInputs).toHaveLength(1);
  await pool.end();
});

test('a storage case missing either persisted reference is not claimed', async () => {
  const pool = testPool();
  await reset(pool);
  const storage = new RecoveringStorage();
  const state = await createUncertainStorageExecution(pool, storage);
  await pool.query(
    'update execution.execution_attempts set output_authorization_ref=null where id=$1',
    [state.attemptId],
  );

  expect(await reconcileNextStorageCompletion(pool, 'worker-reconcile', state.dependencies)).toBe(false);
  expect(storage.reconciliationInputs).toHaveLength(0);
  await pool.end();
});
