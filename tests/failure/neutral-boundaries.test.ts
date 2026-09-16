import { describe, expect, test } from 'vitest';
import { validateExecutionRequest } from '../../src/validation/request.js';

function request(payload: Record<string, unknown>) {
  return {
    contractVersion: 'zx.execution.v1',
    ownerApp: 'owner-a',
    ownerActionId: 'action-a',
    idempotencyKey: 'idem-a',
    requestFingerprint: 'd'.repeat(64),
    payload,
    traceId: 'trace-a',
  };
}

describe('neutral request failure boundaries', () => {
  test('rejects oversized payloads', () => {
    expect(() => validateExecutionRequest(request({ huge: 'x'.repeat(70 * 1024) }))).toThrow(
      'payload JSON exceeds 64 KiB',
    );
  });

  test('rejects excessive nesting', () => {
    const nested = { a: { b: { c: { d: { e: { f: { g: { h: { i: 'too-deep' } } } } } } } } };
    expect(() => validateExecutionRequest(request(nested))).toThrow('JSON depth exceeds 8');
  });
});
