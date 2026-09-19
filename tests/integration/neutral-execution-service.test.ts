import { describe, expect, it } from 'vitest';
import { MemoryRequestService, publicRequestResult } from '../../src/api/routes/requests.js';

const baseRequest = {
  contractVersion: 'zx.execution.v1' as const,
  clientRequestRef: 'client-request-42',
  idempotencyKey: 'idem-42',
  requestFingerprint: 'b'.repeat(64),
  bundleVersionId: '11111111-1111-4111-8111-111111111111',
  storageConnectionId: '22222222-2222-4222-8222-222222222222',
  requestedOutputCount: 3,
  inputPayload: { prompt: 'opaque to the generic control plane', custom: { n: 7 } },
};

describe('generic request service', () => {
  it('plans several internal Jobs under one Request with inherited bundle/storage intent', async () => {
    const service = new MemoryRequestService();
    const submitted = await service.submit('client-a', baseRequest);

    expect(submitted.code).toBe(202);
    expect(submitted.record.jobs).toHaveLength(3);
    expect(new Set(submitted.record.jobs.map((job) => job.bundleVersionId))).toEqual(
      new Set([baseRequest.bundleVersionId]),
    );
    expect(new Set(submitted.record.jobs.map((job) => job.storageConnectionId))).toEqual(
      new Set([baseRequest.storageConnectionId]),
    );
    expect(submitted.record.jobs.map((job) => job.ordinal)).toEqual([1, 2, 3]);

    const publicResult = publicRequestResult(submitted.record);
    expect(publicResult).toEqual({
      contractVersion: 'zx.execution.v1',
      zxRequestId: submitted.record.id,
      clientRequestRef: baseRequest.clientRequestRef,
      state: 'planned',
      requestedOutputCount: 3,
      outputs: [],
    });
    expect(publicResult).not.toHaveProperty('jobs');
  });

  it('returns the same Request for the same client/idempotency/fingerprint tuple', async () => {
    const service = new MemoryRequestService();
    const first = await service.submit('client-a', baseRequest);
    const replay = await service.submit('client-a', baseRequest);
    expect(replay.code).toBe(200);
    expect(replay.record.id).toBe(first.record.id);
  });

  it('keeps idempotency ownership client-scoped', async () => {
    const service = new MemoryRequestService();
    const first = await service.submit('client-a', baseRequest);
    const otherClient = await service.submit('client-b', baseRequest);
    expect(otherClient.record.id).not.toBe(first.record.id);
  });

  it('cancels only through the authenticated client boundary', async () => {
    const service = new MemoryRequestService();
    const submitted = await service.submit('client-a', baseRequest);
    expect(await service.cancel('client-b', submitted.record.id)).toBeNull();
    const cancelled = await service.cancel('client-a', submitted.record.id);
    expect(cancelled?.record.state).toBe('cancelled');
  });
});
