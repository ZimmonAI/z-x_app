import { describe, expect, test } from 'vitest';
import { MemoryExecutionService } from '../../src/api/routes/executions.js';

function request(overrides: Record<string, unknown> = {}) {
  return {
    contractVersion: 'zx.execution.v1',
    ownerApp: 'owner-a',
    ownerActionId: 'action-a',
    idempotencyKey: 'idem-a',
    requestFingerprint: 'b'.repeat(64),
    payload: { value: 1 },
    traceId: 'trace-a',
    ...overrides,
  };
}

describe('neutral execution service', () => {
  test('preserves owner-scoped idempotency and fingerprint conflict behavior', async () => {
    const service = new MemoryExecutionService();
    const created = await service.submit('owner-a', request());
    expect(created.code).toBe(202);

    const duplicate = await service.submit('owner-a', request());
    expect(duplicate.code).toBe(200);
    expect(duplicate.record.id).toBe(created.record.id);

    await expect(
      service.submit('owner-a', request({ requestFingerprint: 'c'.repeat(64) })),
    ).rejects.toThrow('idempotency conflict');
  });

  test('preserves owner isolation', async () => {
    const service = new MemoryExecutionService();
    await expect(service.submit('owner-b', request())).rejects.toMatchObject({ statusCode: 403 });
  });
});
