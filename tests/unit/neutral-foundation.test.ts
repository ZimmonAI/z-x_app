import { describe, expect, it } from 'vitest';
import {
  RequestObjectResultSchema,
  RequestStateSchema,
} from '../../src/contracts/v1/request.js';

describe('generic execution primitives', () => {
  it('keeps Request lifecycle states generic', () => {
    for (const state of [
      'accepted',
      'planned',
      'queued',
      'running',
      'succeeded',
      'failed',
      'cancelled',
      'reconciliation-required',
    ]) {
      expect(RequestStateSchema.parse(state)).toBe(state);
    }
  });

  it('uses stable zxObjectId plus the route-specific locator', () => {
    const zxObjectId = '11111111-1111-4111-8111-111111111111';
    expect(RequestObjectResultSchema.parse({
      position: 1,
      zxObjectId,
      externalObjectId: 'remote-object-id',
    })).toEqual({ position: 1, zxObjectId, externalObjectId: 'remote-object-id' });

    expect(RequestObjectResultSchema.parse({
      position: 2,
      zxObjectId,
      zxTemporaryArtifactId: '22222222-2222-4222-8222-222222222222',
    })).toEqual({
      position: 2,
      zxObjectId,
      zxTemporaryArtifactId: '22222222-2222-4222-8222-222222222222',
    });
  });
});
