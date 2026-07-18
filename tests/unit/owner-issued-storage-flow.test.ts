import { describe, expect, it, vi } from 'vitest';
import { dispatchAndStoreMedia } from '../../src/adapters/types.js';
import { ExecutionRequestV1Schema } from '../../src/contracts/v1/execution.js';

function ownerRequest() {
  return ExecutionRequestV1Schema.parse({
    contractVersion: 'zx.execution.v1',
    ownerApp: 'video-maker_app',
    ownerActionId: 'action-1',
    idempotencyKey: 'action-1',
    requestFingerprint: 'b'.repeat(64),
    operationType: 'image.generate.v1',
    frozenInputResources: [
      {
        resourceId: 'vm-resource-1',
        storageObjectId: 'zs-object-1',
        kind: 'source-image',
        role: 'source-image',
        readGrantRef: 'zs_read_grant_1',
      },
    ],
    safeScalarInputs: {},
    routeLocks: {},
    requestedOutputType: 'image/png',
    ownerStorageAccess: {
      contractVersion: 'zx.owner-storage-access.v1',
      pendingResourceId: 'vm-pending-1',
      outputWriteGrantRef: 'zs_write_grant_1',
      artifactKind: 'image',
      acceptedMimeTypes: ['image/png'],
    },
    traceId: 'trace-owner-flow',
  });
}

describe('owner-issued storage flow', () => {
  it('persists the owner-issued reference and fails before provider dispatch', async () => {
    const startRun = vi.fn();
    const createOutputAuthorization = vi.fn();
    const recordOutputAuthorization = vi.fn(async () => undefined);

    await expect(
      dispatchAndStoreMedia(
        {
          request: ownerRequest(),
          route: {
            routeId: 'route-1',
            routeVersion: '1',
            operation: 'image.generate.v1',
            provider: 'provider',
            model: 'model',
            tool: 'tool',
            software: 'software',
            runMode: 'run-mode',
            adapterId: 'adapter',
            adapterVersion: '1.0.0',
            invocationMode: 'http-json',
            parameterSchemaDigest: 'digest',
            timeoutClass: 'normal',
            resourceClass: 'image',
            authSessionMethodClass: 'server',
            resolvedAt: new Date(0).toISOString(),
          },
          capacity: {
            leaseRef: 'lease-1',
            runtimeBindingRef: 'runtime-1',
            acquiredAt: new Date(0).toISOString(),
            expiresAt: new Date(60_000).toISOString(),
            eligibilityOutcome: 'eligible',
            requirementDigest: 'digest',
          },
          executionId: 'execution-1',
          attemptId: 'attempt-1',
          signal: new AbortController().signal,
          autoHub: {
            startRun,
            getRun: vi.fn(),
            cancelRun: vi.fn(),
          },
          storage: {
            createOutputAuthorization,
            completeOrIngestOutput: vi.fn(),
            reconcileOutput: vi.fn(),
            createReadGrant: vi.fn(),
          },
          recordProviderOutput: vi.fn(),
          recordOutputAuthorization,
        },
        'image',
      ),
    ).rejects.toMatchObject({
      safe: expect.objectContaining({
        code: 'ZX_Z_S_DELEGATED_OUTPUT_NOT_READY',
        retryable: true,
      }),
    });

    expect(recordOutputAuthorization).toHaveBeenCalledWith('zs_write_grant_1');
    expect(startRun).not.toHaveBeenCalled();
    expect(createOutputAuthorization).not.toHaveBeenCalled();
  });
});
