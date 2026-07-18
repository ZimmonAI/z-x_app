import { describe, expect, it } from 'vitest';
import { ExecutionRequestV1Schema } from '../../src/contracts/v1/execution.js';

function request(overrides: Record<string, unknown> = {}) {
  return {
    contractVersion: 'zx.execution.v1',
    ownerApp: 'video-maker_app',
    ownerActionId: 'generation-action-1',
    idempotencyKey: 'owner-action-1',
    requestFingerprint: 'a'.repeat(64),
    operationType: 'image.generate.v1',
    frozenInputResources: [
      {
        resourceId: 'vm_resource_1',
        storageObjectId: 'zs_object_1',
        kind: 'starting-frame',
        role: 'starting-frame',
        readGrantRef: 'zs_read_grant_1',
      },
    ],
    safeScalarInputs: {},
    routeLocks: {},
    requestedOutputType: 'image/png',
    ownerStorageAccess: {
      contractVersion: 'zx.owner-storage-access.v1',
      pendingResourceId: 'vm_pending_resource_1',
      outputWriteGrantRef: 'zs_write_grant_1',
      artifactKind: 'image',
      acceptedMimeTypes: ['image/png'],
      maxBytes: 10_000_000,
    },
    traceId: 'trace-1',
    ...overrides,
  };
}

describe('owner storage access v1', () => {
  it('keeps app resource identity distinct from Z-s storage identity', () => {
    const parsed = ExecutionRequestV1Schema.parse(request());
    expect(parsed.frozenInputResources[0]?.resourceId).toBe('vm_resource_1');
    expect(parsed.frozenInputResources[0]?.storageObjectId).toBe('zs_object_1');
    expect(parsed.frozenInputResources[0]?.resourceId).not.toBe(
      parsed.frozenInputResources[0]?.storageObjectId,
    );
    expect(parsed.ownerStorageAccess?.pendingResourceId).toBe('vm_pending_resource_1');
  });

  it('requires owner storage access for non-fixture generated media', () => {
    const candidate = request({ ownerStorageAccess: undefined });
    expect(() => ExecutionRequestV1Schema.parse(candidate)).toThrow(/ZX_OWNER_STORAGE_ACCESS_REQUIRED/);
  });

  it.each([
    'https://storage.example/write',
    'file:/tmp/output',
    'bucket/video-maker',
    'minio:bucket:objectKey',
    'Bearer token-value',
    'credential=secret',
  ])('rejects non-opaque capability reference %s', (outputWriteGrantRef) => {
    const candidate = request({
      ownerStorageAccess: {
        contractVersion: 'zx.owner-storage-access.v1',
        pendingResourceId: 'vm_pending_resource_1',
        outputWriteGrantRef,
        artifactKind: 'image',
        acceptedMimeTypes: ['image/png'],
      },
    });
    expect(() => ExecutionRequestV1Schema.parse(candidate)).toThrow();
  });

  it('rejects unknown fields and inconsistent output constraints', () => {
    const candidate = request({
      ownerStorageAccess: {
        contractVersion: 'zx.owner-storage-access.v1',
        pendingResourceId: 'vm_pending_resource_1',
        outputWriteGrantRef: 'zs_write_grant_1',
        artifactKind: 'video',
        acceptedMimeTypes: ['video/mp4'],
        bucket: 'prohibited',
      },
    });
    expect(() => ExecutionRequestV1Schema.parse(candidate)).toThrow();
  });

  it('preserves legacy requests only when fixture mode is explicit', () => {
    const parsed = ExecutionRequestV1Schema.parse(
      request({
        frozenInputResources: [{ resourceId: 'legacy-resource', kind: 'legacy-input' }],
        ownerStorageAccess: undefined,
        safeScalarInputs: { fixtureScenario: 'success' },
      }),
    );
    expect(parsed.safeScalarInputs.fixtureScenario).toBe('success');
  });
});
