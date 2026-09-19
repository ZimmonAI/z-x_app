import { describe, expect, it } from 'vitest';
import { MemoryRequestService } from '../../src/api/routes/requests.js';
import { validateRequest } from '../../src/validation/request.js';

const request = {
  contractVersion: 'zx.execution.v1' as const,
  idempotencyKey: 'idem-conflict',
  requestFingerprint: 'c'.repeat(64),
  bundleVersionId: '11111111-1111-4111-8111-111111111111',
  requestedOutputCount: 1,
  inputPayload: { arbitrary: true },
};

describe('generic request failure boundaries', () => {
  it('returns conflict semantics for an idempotency key reused with a changed fingerprint', async () => {
    const service = new MemoryRequestService();
    await service.submit('client-a', request);
    await expect(service.submit('client-a', {
      ...request,
      requestFingerprint: 'd'.repeat(64),
    })).rejects.toMatchObject({ statusCode: 409 });
  });

  it('rejects body identity impersonation', () => {
    expect(() => validateRequest({ ...request, clientKey: 'client-b' })).toThrow();
    expect(() => validateRequest({ ...request, ownerApp: 'client-b' })).toThrow();
  });

  it('rejects oversized output requests and oversized opaque payload strings', () => {
    expect(() => validateRequest({ ...request, requestedOutputCount: 257 })).toThrow();
    expect(() => validateRequest({
      ...request,
      inputPayload: { value: 'x'.repeat(4097) },
    })).toThrow();
  });
});
