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
import { ExecutionsRepository } from '../../src/persistence/repositories/executions.js';
import { claimNext } from '../../src/worker/claim.js';
import {
  completeClaimedExecution,
  prepareNextExecution,
  type FixtureDependencies,
} from '../../src/worker/lifecycle.js';
import { reconcileNextStorageCompletion } from '../../src/worker/reconciliation.js';
import { validRequest } from '../unit/test-request.js';
import { reset, testPool } from '../integration/db-helper.js';

class OutcomeStorage extends ZStorageFixtureV1 {
  readonly reconciliationInputs: ReconcileOutputV1[] = [];

  constructor(private readonly outcome: OutputReconciliationV1 | Error) {
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
    _signal: AbortSignal,
  ): Promise<OutputReconciliationV1> {
    this.reconciliationInputs.push(input);
    if (this.outcome instanceof Error) throw this.outcome;
    return this.outcome;
  }
}

function imageStorageRequest() {
  return {
    ...validRequest('image.generate.v1'),
    safeScalarInputs: { prompt: 'cinematic sunrise', fixtureScenario: 'success' },
    requestedOutputType: 'image/png',
    storageOutput: {
      contractVersion: 'zx.storage-output.v1',
      mode: 'post-run-ingest',
      artifactKind: 'image',
      acceptedMimeTypes: ['image/png'],
    },
  };
}

async function createUncertainExecution(
  pool: ReturnType<typeof testPool>,
  storage: OutcomeStorage,
): Promise<{
  dependencies: FixtureDependencies;
  executionId: string;
  attemptId: string;
  caseId: string;
  authorizationRef: string;
  safeProviderOutputRef: string;
  originalNextCheckAt: Date;
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

  const stored = await pool.query<{
    case_id: string;
    next_check_at: Date;
    output_authorization_ref: string;
    safe_provider_output_ref: string;
  }>(
    `select c.id as case_id, c.next_check_at,
            a.output_authorization_ref, a.safe_provider_output_ref
       from execution.execution_attempts a
       join execution.execution_reconciliation_cases c
         on c.execution_id=a.execution_id and c.attempt_id=a.id
      where a.id=$1`,
    [claim.attemptId],
  );
  const row = stored.rows[0];
  if (!row) throw new Error('expected reconciliation case');
  return {
    dependencies,
    executionId: claim.executionId,
    attemptId: claim.attemptId,
    caseId: row.case_id,
    authorizationRef: row.output_authorization_ref,
    safeProviderOutputRef: row.safe_provider_output_ref,
    originalNextCheckAt: row.next_check_at,
  };
}

async function expectOneAttempt(pool: ReturnType<typeof testPool>, executionId: string) {
  const attempts = await pool.query<{ count: string }>(
    'select count(*) from execution.execution_attempts where execution_id=$1',
    [executionId],
  );
  expect(Number(attempts.rows[0]?.count)).toBe(1);
}

test('pending reconciliation preserves state and advances the bounded next check', async () => {
  const pool = testPool();
  await reset(pool);
  const storage = new OutcomeStorage({ status: 'pending', retryAfterSeconds: 12 });
  const state = await createUncertainExecution(pool, storage);

  await expect(
    reconcileNextStorageCompletion(pool, 'worker-reconcile', 60, state.dependencies),
  ).resolves.toBe(true);
  const stored = await pool.query<{
    execution_status: string;
    attempt_status: string;
    case_status: string;
    next_check_at: Date;
    output_authorization_ref: string;
    safe_provider_output_ref: string;
  }>(
    `select e.status as execution_status, a.status as attempt_status,
            c.status as case_status, c.next_check_at,
            a.output_authorization_ref, a.safe_provider_output_ref
       from execution.executions e
       join execution.execution_attempts a on a.id=$2 and a.execution_id=e.id
       join execution.execution_reconciliation_cases c on c.id=$3
      where e.id=$1`,
    [state.executionId, state.attemptId, state.caseId],
  );
  expect(stored.rows[0]).toMatchObject({
    execution_status: 'reconciliation-required',
    attempt_status: 'reconciliation-required',
    case_status: 'open',
    output_authorization_ref: state.authorizationRef,
    safe_provider_output_ref: state.safeProviderOutputRef,
  });
  expect(stored.rows[0]?.next_check_at.getTime()).toBeGreaterThan(
    state.originalNextCheckAt.getTime(),
  );
  expect(stored.rows[0]?.next_check_at.getTime()).toBeLessThanOrEqual(Date.now() + 300_000);
  await expectOneAttempt(pool, state.executionId);
  await pool.end();
});

test('retryable storage failure preserves references with bounded backoff', async () => {
  const pool = testPool();
  await reset(pool);
  const storage = new OutcomeStorage({
    status: 'failed',
    errorCode: 'ZX_STORAGE_STILL_UNCERTAIN',
    retryable: true,
  });
  const state = await createUncertainExecution(pool, storage);

  await expect(
    reconcileNextStorageCompletion(pool, 'worker-reconcile', 45, state.dependencies),
  ).resolves.toBe(true);
  const stored = await pool.query<{
    execution_status: string;
    attempt_status: string;
    case_status: string;
    next_check_at: Date;
    safe_details: Record<string, unknown>;
    output_authorization_ref: string;
    safe_provider_output_ref: string;
  }>(
    `select e.status as execution_status, a.status as attempt_status,
            c.status as case_status, c.next_check_at, c.safe_details,
            a.output_authorization_ref, a.safe_provider_output_ref
       from execution.executions e
       join execution.execution_attempts a on a.id=$2 and a.execution_id=e.id
       join execution.execution_reconciliation_cases c on c.id=$3
      where e.id=$1`,
    [state.executionId, state.attemptId, state.caseId],
  );
  expect(stored.rows[0]).toMatchObject({
    execution_status: 'reconciliation-required',
    attempt_status: 'reconciliation-required',
    case_status: 'open',
    safe_details: { code: 'ZX_STORAGE_STILL_UNCERTAIN', retryable: true },
    output_authorization_ref: state.authorizationRef,
    safe_provider_output_ref: state.safeProviderOutputRef,
  });
  expect(stored.rows[0]?.next_check_at.getTime()).toBeGreaterThan(Date.now());
  expect(stored.rows[0]?.next_check_at.getTime()).toBeLessThanOrEqual(Date.now() + 300_000);
  await expectOneAttempt(pool, state.executionId);
  await pool.end();
});

test('lookup exceptions remain open and retryable instead of claiming terminal failure', async () => {
  const pool = testPool();
  await reset(pool);
  const storage = new OutcomeStorage(new Error('temporary lookup transport failure'));
  const state = await createUncertainExecution(pool, storage);

  await expect(
    reconcileNextStorageCompletion(pool, 'worker-reconcile', 30, state.dependencies),
  ).resolves.toBe(true);
  const stored = await pool.query<{
    execution_status: string;
    attempt_status: string;
    case_status: string;
    resolution_code: string | null;
  }>(
    `select e.status as execution_status, a.status as attempt_status,
            c.status as case_status, c.resolution_code
       from execution.executions e
       join execution.execution_attempts a on a.id=$2 and a.execution_id=e.id
       join execution.execution_reconciliation_cases c on c.id=$3
      where e.id=$1`,
    [state.executionId, state.attemptId, state.caseId],
  );
  expect(stored.rows[0]).toEqual({
    execution_status: 'reconciliation-required',
    attempt_status: 'reconciliation-required',
    case_status: 'open',
    resolution_code: null,
  });
  await expectOneAttempt(pool, state.executionId);
  await pool.end();
});

test('confirmed terminal storage failure fails the original attempt truthfully', async () => {
  const pool = testPool();
  await reset(pool);
  const storage = new OutcomeStorage({
    status: 'failed',
    errorCode: 'ZX_STORAGE_OBJECT_MISSING',
    retryable: false,
  });
  const state = await createUncertainExecution(pool, storage);

  await expect(
    reconcileNextStorageCompletion(pool, 'worker-reconcile', 60, state.dependencies),
  ).resolves.toBe(true);
  const stored = await pool.query<{
    execution_status: string;
    result_envelope: unknown;
    error_envelope: { family: string; code: string; retryable: boolean };
    attempt_status: string;
    error_family: string;
    error_code: string;
    output_authorization_ref: string;
    safe_provider_output_ref: string;
    case_status: string;
    resolution_code: string;
  }>(
    `select e.status as execution_status, e.result_envelope, e.error_envelope,
            a.status as attempt_status, a.error_family, a.error_code,
            a.output_authorization_ref, a.safe_provider_output_ref,
            c.status as case_status, c.resolution_code
       from execution.executions e
       join execution.execution_attempts a on a.id=$2 and a.execution_id=e.id
       join execution.execution_reconciliation_cases c on c.id=$3
      where e.id=$1`,
    [state.executionId, state.attemptId, state.caseId],
  );
  expect(stored.rows[0]).toMatchObject({
    execution_status: 'failed',
    result_envelope: null,
    error_envelope: {
      family: 'storage-output-failure',
      code: 'ZX_STORAGE_OBJECT_MISSING',
      retryable: false,
    },
    attempt_status: 'failed',
    error_family: 'storage-output-failure',
    error_code: 'ZX_STORAGE_OBJECT_MISSING',
    output_authorization_ref: state.authorizationRef,
    safe_provider_output_ref: state.safeProviderOutputRef,
    case_status: 'resolved',
    resolution_code: 'storage-completion-terminal-failure',
  });
  const transition = await pool.query<{ count: string }>(
    `select count(*) from execution.execution_status_transitions
      where execution_id=$1 and from_status='reconciliation-required'
        and to_status='failed' and reason_family='storage-output-failure'`,
    [state.executionId],
  );
  expect(Number(transition.rows[0]?.count)).toBe(1);
  await expectOneAttempt(pool, state.executionId);
  await pool.end();
});
