import { describe, expect, it } from 'vitest';
import {
  RequestObjectResultSchema,
  RequestResultV1Schema,
  RequestV1Schema,
} from '../../src/contracts/v1/request.js';

const request = {
  contractVersion: 'zx.execution.v1' as const,
  idempotencyKey: 'idem-1',
  requestFingerprint: 'a'.repeat(64),
  bundleVersionId: '11111111-1111-4111-8111-111111111111',
  requestedOutputCount: 3,
  inputPayload: {
    anyClientShape: true,
    nested: { values: [1, 'two', false] },
  },
};

describe('generic request contract', () => {
  it('accepts arbitrary structured client payload without business taxonomy', () => {
    expect(RequestV1Schema.parse(request).inputPayload).toEqual(request.inputPayload);
  });

  it('rejects caller identity and unknown control fields from the JSON body', () => {
    expect(() => RequestV1Schema.parse({ ...request, ownerApp: 'impersonated' })).toThrow();
    expect(() => RequestV1Schema.parse({ ...request, provider: 'vendor-x' })).toThrow();
    expect(() => RequestV1Schema.parse({ ...request, model: 'model-y' })).toThrow();
  });

  it('requires an exact bundle version UUID', () => {
    expect(() => RequestV1Schema.parse({ ...request, bundleVersionId: 'latest' })).toThrow();
  });

  it('requires exactly one handback locator per produced object', () => {
    const base = {
      position: 1,
      zxObjectId: '22222222-2222-4222-8222-222222222222',
    };
    expect(RequestObjectResultSchema.parse({ ...base, externalObjectId: 'remote/object/1' })).toEqual({
      ...base,
      externalObjectId: 'remote/object/1',
    });
    expect(RequestObjectResultSchema.parse({
      ...base,
      zxTemporaryArtifactId: '33333333-3333-4333-8333-333333333333',
    })).toEqual({
      ...base,
      zxTemporaryArtifactId: '33333333-3333-4333-8333-333333333333',
    });
    expect(() => RequestObjectResultSchema.parse(base)).toThrow();
    expect(() => RequestObjectResultSchema.parse({
      ...base,
      externalObjectId: 'remote/object/1',
      zxTemporaryArtifactId: '33333333-3333-4333-8333-333333333333',
    })).toThrow();
  });

  it('keeps the poll envelope request-facing and strict', () => {
    expect(RequestResultV1Schema.parse({
      contractVersion: 'zx.execution.v1',
      zxRequestId: '44444444-4444-4444-8444-444444444444',
      state: 'running',
      requestedOutputCount: 3,
      outputs: [],
    })).toBeTruthy();
    expect(() => RequestResultV1Schema.parse({
      contractVersion: 'zx.execution.v1',
      zxRequestId: '44444444-4444-4444-8444-444444444444',
      state: 'running',
      requestedOutputCount: 3,
      outputs: [],
      jobIds: [],
    })).toThrow();
  });
});
