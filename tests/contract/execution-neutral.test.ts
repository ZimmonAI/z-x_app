import { describe, expect, test } from 'vitest';
import { ExecutionRequestV1Schema } from '../../src/contracts/v1/execution.js';

const baseRequest = {
  contractVersion: 'zx.execution.v1' as const,
  ownerApp: 'test-owner',
  ownerActionId: 'action-1',
  idempotencyKey: 'idem-1',
  requestFingerprint: 'a'.repeat(64),
  payload: { arbitrary: { structured: ['value'] } },
  traceId: 'trace-1',
};

describe('neutral execution contract', () => {
  test('accepts an opaque structured payload without a job taxonomy', () => {
    const parsed = ExecutionRequestV1Schema.parse(baseRequest);
    expect(parsed.payload).toEqual(baseRequest.payload);
    expect(parsed.priority).toBe(5);
  });

  test('rejects removed execution semantics', () => {
    for (const legacyField of [
      { operationType: 'image.generate.v1' },
      { toolKey: 'google-flow' },
      { executionMethodId: 'future-method' },
      { delegatedAuthorities: [] },
      { ownerStorageAccess: {} },
      { storageOutput: {} },
      { routeLocks: {} },
    ]) {
      expect(() => ExecutionRequestV1Schema.parse({ ...baseRequest, ...legacyField })).toThrow();
    }
  });
});
