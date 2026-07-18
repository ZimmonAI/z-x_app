import { describe, expect, it } from 'vitest';
import {
  LegacyFixtureOutputResourceV1Schema,
  OwnerCorrelatedStorageOutputV1Schema,
} from '../../src/contracts/v1/result.js';

describe('owner storage authority boundary', () => {
  it('accepts only owner correlation and Z-s technical identity on the owner result', () => {
    const parsed = OwnerCorrelatedStorageOutputV1Schema.parse({
      pendingResourceId: 'vm-pending-1',
      storageObjectId: 'zs-object-1',
      checksumSha256: 'c'.repeat(64),
      mimeType: 'video/mp4',
      sizeBytes: 1024,
      width: 1920,
      height: 1080,
      durationSeconds: 5,
    });
    expect(parsed.pendingResourceId).toBe('vm-pending-1');
    expect(parsed.storageObjectId).toBe('zs-object-1');
    expect(parsed).not.toHaveProperty('resourceId');
    expect(parsed).not.toHaveProperty('resourceVersionId');
  });

  it.each([
    ['resourceId', 'created-by-z-x'],
    ['resourceVersionId', 'version-created-by-z-x'],
    ['providerUrl', 'https://provider.example/object'],
    ['bucket', 'video-maker'],
    ['prefix', 'video-maker/generated'],
    ['objectKey', 'generated/output.mp4'],
    ['credential', 'secret'],
    ['internalLocator', '/tmp/output.mp4'],
  ])('rejects prohibited owner-result field %s', (field, value) => {
    expect(() =>
      OwnerCorrelatedStorageOutputV1Schema.parse({
        pendingResourceId: 'vm-pending-1',
        storageObjectId: 'zs-object-1',
        checksumSha256: 'c'.repeat(64),
        mimeType: 'image/png',
        sizeBytes: 512,
        width: 1024,
        height: 1024,
        [field]: value,
      }),
    ).toThrow();
  });

  it('isolates the old result shape in the fixture compatibility parser', () => {
    expect(
      LegacyFixtureOutputResourceV1Schema.parse({
        resourceId: 'fixture-resource',
        resourceVersionId: 'fixture-version',
        storageIdentity: 'zs://fixture/resource/version',
        checksumSha256: 'd'.repeat(64),
        mimeType: 'image/png',
        sizeBytes: 512,
        width: 1024,
        height: 1024,
      }).resourceId,
    ).toBe('fixture-resource');
  });
});
