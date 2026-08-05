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

  const routeCalls = vi.spyOn(state.dependencies.routes, 'resolveAndValidateRoute');
  const capacityAcquireCalls = vi.spyOn(state.dependencies.capacity, 'acquire');
  const capacityReportCalls = vi.spyOn(state.dependencies.capacity, 'reportOutcome');
  const capacityReleaseCalls = vi.spyOn(state.dependencies.capacity, 'release');
  const providerCalls = vi.spyOn(state.dependencies.autoHub, 'startRun');
  const authorizationCalls = vi.spyOn(storage, 'createOutputAuthorization');
  const callsBefore = {
    route: routeCalls.mock.calls.length,
    acquire: capacityAcquireCalls.mock.calls.length,
    report: capacityReportCalls.mock.calls.length,
    release: capacityReleaseCalls.mock.calls.length,
    provider: providerCalls.mock.calls.length,
    authorization: authorizationCalls.mock.calls.length,
  };

  await expect(
    reconcileNextStorageCompletion(pool, 'worker-reconcile', 60, state.dependencies),
  ).resolves.toBe(true);

  expect(storage.reconciliationInputs).toEqual([
    expect.objectContaining({
      executionId: state.executionId,
      attemptId: state.attemptId,
      authorizationRef: state.authorizationRef,
      safeProviderOutputRef: state.safeProviderOutputRef,
      mimeType: 'image/png',
    }),
  ]);
  expect(routeCalls).toHaveBeenCalledTimes(callsBefore.route);
  expect(capacityAcquireCalls).toHaveBeenCalledTimes(callsBefore.acquire);
  expect(capacityReportCalls).toHaveBeenCalledTimes(callsBefore.report);
  expect(capacityReleaseCalls).toHaveBeenCalledTimes(callsBefore.release);
  expect(providerCalls).toHaveBeenCalledTimes(callsBefore.provider);
  expect(authorizationCalls).toHaveBeenCalledTimes(callsBefore.authorization);

  const stored = await pool.query<{
    execution_status: string;
    result_envelope: unknown;
    attempt_status: string;
    output_authorization_ref: string;
    safe_provider_output_ref: string;
    case_status: string;
    resolution_code: string | null;
  }>(
    `select e.status as execution_status, e.result_envelope,
            a.status as attempt_status, a.output_authorization_ref,
            a.safe_provider_output_ref, c.status as case_status, c.resolution_code
       from execution.executions e
       join execution.execution_attempts a on a.id=$2 and a.execution_id=e.id
       join execution.execution_reconciliation_cases c on c.id=$3
      where e.id=$1`,
    [state.executionId, state.attemptId, state.caseId],
  );
  expect(stored.rows[0]).toMatchObject({
    execution_status: 'succeeded',
    attempt_status: 'succeeded',
    output_authorization_ref: state.authorizationRef,
    safe_provider_output_ref: state.safeProviderOutputRef,
    case_status: 'resolved',
    resolution_code: 'storage-result-confirmed',
  });
  const result = ExecutionResultV1Schema.parse(stored.rows[0]?.result_envelope);
  expect(result.attemptId).toBe(state.attemptId);
  expect(result.outputs).toHaveLength(1);
  expect(result.outputs[0]?.storageIdentity).toMatch(/^zs:\/\/fixture\//);

  await expect(
    reconcileNextStorageCompletion(pool, 'worker-reconcile-again', 60, state.dependencies),
  ).resolves.toBe(false);
  const counts = await pool.query<{ attempts: string; transitions: string }>(
    `select
       (select count(*) from execution.execution_attempts where execution_id=$1) as attempts,
       (select count(*) from execution.execution_status_transitions
         where execution_id=$1 and reason_family='storage-completion-reconciled') as transitions`,
    [state.executionId],
  );
  expect(Number(counts.rows[0]?.attempts)).toBe(1);
  expect(Number(counts.rows[0]?.transitions)).toBe(1);
  await pool.end();
});

test('two workers cannot finalize the same storage reconciliation case twice', async () => {
  const pool = testPool();
  await reset(pool);
  const storage = new RecoveringStorage(50);
  const state = await createUncertainStorageExecution(pool, storage);

  const outcomes = await Promise.all([
    reconcileNextStorageCompletion(pool, 'worker-a', 60, state.dependencies),
    reconcileNextStorageCompletion(pool, 'worker-b', 60, state.dependencies),
  ]);
  expect(outcomes.sort()).toEqual([false, true]);
  expect(storage.reconciliationInputs).toHaveLength(1);

  const counts = await pool.query<{ attempts: string; transitions: string }>(
    `select
       (select count(*) from execution.execution_attempts where execution_id=$1) as attempts,
       (select count(*) from execution.execution_status_transitions
         where execution_id=$1 and reason_family='storage-completion-reconciled') as transitions`,
    [state.executionId],
  );
  expect(Number(counts.rows[0]?.attempts)).toBe(1);
  expect(Number(counts.rows[0]?.transitions)).toBe(1);
  await pool.end();
});

test('a stale resolving claim is reclaimable after its deadline', async () => {
  const pool = testPool();
  await reset(pool);
  const storage = new RecoveringStorage();
  const state = await createUncertainStorageExecution(pool, storage);
  await pool.query(
    `update execution.execution_reconciliation_cases
        set status='resolving', next_check_at=now()-interval '1 second'
      where id=$1`,
    [state.caseId],
  );

  await expect(
    reconcileNextStorageCompletion(pool, 'worker-reclaim', 60, state.dependencies),
  ).resolves.toBe(true);
  const stored = await pool.query<{ status: string }>(
    'select status from execution.executions where id=$1',
    [state.executionId],
  );
  expect(stored.rows[0]?.status).toBe('succeeded');
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

  await expect(
    reconcileNextStorageCompletion(pool, 'worker-reconcile', 60, state.dependencies),
  ).resolves.toBe(false);
  expect(storage.reconciliationInputs).toHaveLength(0);
  const stored = await pool.query<{ status: string }>(
    'select status from execution.executions where id=$1',
    [state.executionId],
  );
  expect(stored.rows[0]?.status).toBe('reconciliation-required');
  await pool.end();
});
