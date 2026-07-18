import { ZStorageFixtureV1 } from '../../fixtures/v1/z-s.js';
import {
  parseOutputReconciliationV1,
  parseReconcileOutputV1,
  type ReconcileOutputV1,
} from '../../src/contracts/v1/dependencies.js';

const signal = new AbortController().signal;
const validInput: ReconcileOutputV1 = {
  executionId: 'execution-1',
  attemptId: 'attempt-1',
  authorizationRef: 'authorization-1',
  safeProviderOutputRef: 'safe-provider-output-1',
  mimeType: 'image/png',
};

test.each([
  ['credentials', { token: 'secret' }],
  ['provider URL', { providerUrl: 'https://provider.invalid/output' }],
  ['bucket', { bucket: 'private-bucket' }],
  ['prefix', { prefix: 'owner/private' }],
  ['key', { key: 'object-key' }],
  ['local path', { localPath: '/tmp/output.png' }],
  ['signed URL', { signedUrl: 'https://storage.invalid/signed' }],
  ['provider payload', { providerPayload: { unrestricted: true } }],
])('storage reconciliation input rejects %s fields', (_label, prohibited) => {
  expect(() => parseReconcileOutputV1({ ...validInput, ...prohibited })).toThrow(/prohibited field/);
});

test('storage reconciliation pending result enforces bounded integer retry', () => {
  expect(parseOutputReconciliationV1({ status: 'pending', retryAfterSeconds: 1 })).toEqual({
    status: 'pending',
    retryAfterSeconds: 1,
  });
  expect(parseOutputReconciliationV1({ status: 'pending', retryAfterSeconds: 300 })).toEqual({
    status: 'pending',
    retryAfterSeconds: 300,
  });
  expect(() => parseOutputReconciliationV1({ status: 'pending', retryAfterSeconds: 0 })).toThrow();
  expect(() => parseOutputReconciliationV1({ status: 'pending', retryAfterSeconds: 301 })).toThrow();
  expect(() => parseOutputReconciliationV1({ status: 'pending', retryAfterSeconds: 1.5 })).toThrow();
  expect(() =>
    parseOutputReconciliationV1({
      status: 'pending',
      retryAfterSeconds: 30,
      providerUrl: 'https://provider.invalid',
    }),
  ).toThrow(/prohibited field/);
});

test('Z-s fixture reconciliation is deterministic and idempotent for identical safe references', async () => {
  const fixture = new ZStorageFixtureV1();
  const first = await fixture.reconcileOutput(validInput, signal);
  const second = await fixture.reconcileOutput(validInput, signal);

  expect(first).toEqual(second);
  expect(first.status).toBe('completed');
  if (first.status !== 'completed') throw new Error('expected completed fixture result');
  expect(first.result.storageIdentity).toMatch(/^zs:\/\/fixture\//);
  expect(first.result.mimeType).toBe(validInput.mimeType);
});

test('Z-s fixture exposes bounded pending, retryable failure, and terminal failure outcomes', async () => {
  const fixture = new ZStorageFixtureV1();
  await expect(
    fixture.reconcileOutput(
      { ...validInput, fixtureScenario: 'storage-reconciliation-pending' },
      signal,
    ),
  ).resolves.toEqual({ status: 'pending', retryAfterSeconds: 30 });
  await expect(
    fixture.reconcileOutput(
      { ...validInput, fixtureScenario: 'storage-reconciliation-retryable-failure' },
      signal,
    ),
  ).resolves.toEqual({
    status: 'failed',
    errorCode: 'ZX_STORAGE_RECONCILIATION_RETRYABLE',
    retryable: true,
  });
  await expect(
    fixture.reconcileOutput(
      { ...validInput, fixtureScenario: 'storage-reconciliation-terminal-failure' },
      signal,
    ),
  ).resolves.toEqual({
    status: 'failed',
    errorCode: 'ZX_STORAGE_RECONCILIATION_TERMINAL',
    retryable: false,
  });
});
