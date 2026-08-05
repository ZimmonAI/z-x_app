import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { afterEach, expect, test, vi } from 'vitest';
import { ZStorageFixtureV1 } from '../../fixtures/v1/z-s.js';
import { ExecutionResultV1Schema } from '../../src/contracts/v1/result.js';
import type { Dependencies } from '../../src/dependencies.js';
import { reconcileNextStorageCompletion } from '../../src/worker/reconcile-storage.js';
import { applyMigrations, cleanupPool, createTestPool } from '../helpers/database.js';
import { validRequest } from '../unit/test-request.js';

const pools: Pool[] = [];
afterEach(async () => cleanupPool(pools));

async function createStorageReconciliationCase() {
  const pool = createTestPool();
  pools.push(pool);
  await applyMigrations(pool);

  const executionId = randomUUID();
  const attemptId = randomUUID();
  const caseId = randomUUID();
  const authorizationRef = `auth-${randomUUID()}`;
  const safeProviderOutputRef = `safe-provider-${randomUUID()}`;
  const request = validRequest('image.generate.v1');

  await pool.query(
    `insert into execution.executions
       (id, owner_app, owner_action_id, idempotency_key, request_fingerprint,
        contract_version, operation_type, request_envelope, status, current_attempt_count,
        created_at, updated_at)
     values ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,'reconciliation-required',1,now(),now())`,
    [
      executionId,
      request.ownerApp,
      request.ownerActionId,
      request.idempotencyKey,
      request.requestFingerprint,
      request.contractVersion,
      request.operationType,
      JSON.stringify(request),
    ],
  );
  await pool.query(
    `insert into execution.execution_attempts
       (id, execution_id, attempt_number, status, output_authorization_ref,
        safe_provider_output_ref, started_at, completed_at)
     values ($1,$2,1,'reconciliation-required',$3,$4,now(),now())`,
    [attemptId, executionId, authorizationRef, safeProviderOutputRef],
  );
  await pool.query(
    `insert into execution.execution_reconciliation_cases
       (id, execution_id, attempt_id, reason_family, status, created_at, updated_at)
     values ($1,$2,$3,'storage-completion-uncertain','open',now(),now())`,
    [caseId, executionId, attemptId],
  );

  const fixture = new ZStorageFixtureV1();
  const complete = await fixture.completeOrIngestOutput(
    {
      executionId,
      attemptId,
      authorizationRef,
      safeProviderOutputRef,
      mimeType: request.requestedOutputType,
      fixtureScenario: 'success',
    },
    new AbortController().signal,
  );

  const capacityReleaseCalls = vi.fn();
  const providerCalls = vi.fn();
  const authorizationCalls = vi.fn();
  const dependencies = {
    routeRegistry: {
      resolveRoute: providerCalls,
    },
    capacity: {
      acquire: providerCalls,
      renew: providerCalls,
      release: capacityReleaseCalls,
      reportOutcome: providerCalls,
    },
    autoHub: {
      startRun: providerCalls,
      getRun: providerCalls,
      cancelRun: providerCalls,
    },
    zStorage: {
      createOutputAuthorization: authorizationCalls,
      completeOrIngestOutput: authorizationCalls,
      reconcileOutput: vi.fn().mockResolvedValue({ status: 'completed', result: complete }),
      createReadGrant: providerCalls,
    },
    ownerDelivery: {
      deliver: providerCalls,
    },
  } as unknown as Dependencies;

  return {
    pool,
    executionId,
    attemptId,
    caseId,
    authorizationRef,
    safeProviderOutputRef,
    dependencies,
    capacityReleaseCalls,
    providerCalls,
    authorizationCalls,
  };
}

test('storage reconciliation finalizes a provider-success execution without redispatch', async () => {
  const state = await createStorageReconciliationCase();
  const {
    pool,
    capacityReleaseCalls,
    providerCalls,
    authorizationCalls,
  } = state;
  const callsBefore = {
    release: capacityReleaseCalls.mock.calls.length,
    provider: providerCalls.mock.calls.length,
    authorization: authorizationCalls.mock.calls.length,
  };

  await expect(
    reconcileNextStorageCompletion(pool, 'worker-reconcile', 60, state.dependencies),
  ).resolves.toBe(true);
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
  const output = result.outputs[0];
  expect(output).toBeDefined();
  if (!output || !('storageIdentity' in output)) {
    throw new Error('expected legacy fixture storage output');
  }
  expect(output.storageIdentity).toMatch(/^zs:\/\/fixture\//);

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
  const state = await createStorageReconciliationCase();
  const results = await Promise.all([
    reconcileNextStorageCompletion(state.pool, 'worker-a', 60, state.dependencies),
    reconcileNextStorageCompletion(state.pool, 'worker-b', 60, state.dependencies),
  ]);
  expect(results.filter(Boolean)).toHaveLength(1);

  const stored = await state.pool.query<{ count: string }>(
    `select count(*)::text as count
       from execution.execution_status_transitions
      where execution_id=$1 and reason_family='storage-completion-reconciled'`,
    [state.executionId],
  );
  expect(Number(stored.rows[0]?.count)).toBe(1);
  await state.pool.end();
});
