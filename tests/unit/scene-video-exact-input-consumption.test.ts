import { describe, expect, it, vi } from 'vitest';
import { sceneVideoGenerateAdapter } from '../../src/adapters/scene-video-generate.js';
import { ExecutionRequestV1Schema } from '../../src/contracts/v1/execution.js';

function stream(bytes: readonly number[]): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new Uint8Array(bytes));
      controller.close();
    },
  });
}

describe('scene-video exact owner input consumption', () => {
  it('reads the exact owner-selected Z-s object and supplies verified bytes to runtime dispatch', async () => {
    const request = ExecutionRequestV1Schema.parse({
      contractVersion: 'zx.execution.v1',
      ownerApp: 'video-maker_app',
      ownerActionId: 'action-scene-video-1',
      ownerProjectId: 'series-1',
      idempotencyKey: 'scene-video-1',
      requestFingerprint: 'a'.repeat(64),
      operationType: 'scene_video.generate.v1',
      executionMethodRef: 'vm-method:scene-video:variant-1',
      frozenInputResources: [{
        resourceId: 'resource-start-1',
        resourceVersionId: 'image-version-1',
        storageObjectId: 'zs-start-object-1',
        kind: 'start-image',
        role: 'start-image',
        readGrantRef: 'zs_read_grant_start_1',
      }],
      safeScalarInputs: { prompt: 'Slow camera move.' },
      routeLocks: {},
      requestedOutputType: 'video/mp4',
      ownerStorageAccess: {
        contractVersion: 'zx.owner-storage-access.v1',
        pendingResourceId: 'pending-video-resource-1',
        outputWriteGrantRef: 'zs_write_grant_video_1',
        artifactKind: 'video',
        acceptedMimeTypes: ['video/mp4'],
        maxBytes: 1000000,
      },
      traceId: 'trace-scene-video-input',
    });

    const readExactObject = vi.fn(async () => ({
      storageObjectId: 'zs-start-object-1',
      mimeType: 'image/png',
      sizeBytes: 4,
      checksumSha256: 'c'.repeat(64),
      body: stream([1, 2, 3, 4]),
    }));
    let observedInputBytes: number[] = [];
    const startRun = vi.fn(async (input: {
      preparedInputs?: readonly { body: ReadableStream<Uint8Array>; storageObjectId: string }[];
    }) => {
      const prepared = input.preparedInputs?.[0];
      if (!prepared) throw new Error('prepared input missing');
      observedInputBytes = Array.from(new Uint8Array(await new Response(prepared.body).arrayBuffer()));
      expect(prepared.storageObjectId).toBe('zs-start-object-1');
      return { runRef: 'run-1', status: 'succeeded' as const, safeOutputRef: 'provider-output-1' };
    });

    const result = await sceneVideoGenerateAdapter.execute({
      request,
      route: {
        routeId: 'route-1',
        routeVersion: '1',
        operation: 'scene_video.generate.v1',
        provider: 'provider',
        model: 'model',
        tool: 'tool',
        software: 'software',
        runMode: 'run-mode',
        adapterId: 'scene-video-generate-v1',
        adapterVersion: '1.0.0',
        invocationMode: 'http-json',
        parameterSchemaDigest: 'digest',
        timeoutClass: 'normal',
        resourceClass: 'video',
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
        createOutputAuthorization: vi.fn(),
        completeOrIngestOutput: vi.fn(),
        reconcileOutput: vi.fn(),
        createReadGrant: vi.fn(),
        readExactObject,
        createDelegatedOutputWriteIntent: vi.fn(async () => ({
          writeIntentId: 'write-intent-1',
          storageObjectId: 'zs-output-object-1',
          uploadCompletionToken: 'upload-token-1',
          expiresAt: new Date(60_000).toISOString(),
        })),
        writeDelegatedOutput: vi.fn(async (input) => ({
          storageObjectId: 'zs-output-object-1',
          writeIntentId: 'write-intent-1',
          checksumSha256: input.artifact.checksumSha256,
          mimeType: 'video/mp4',
          sizeBytes: input.artifact.sizeBytes,
          width: 1920,
          height: 1080,
          durationSeconds: 5,
          objectProtectionStage: 'verified',
          storageState: 'ready' as const,
        })),
      },
      temporaryArtifacts: {
        capture: vi.fn(async () => ({
          ownerApp: 'video-maker_app',
          ownerProjectId: 'series-1',
          executionId: 'execution-1',
          attemptId: 'attempt-1',
          artifactRef: 'zx-temp:output-1',
          mimeType: 'video/mp4',
          sizeBytes: 4,
          checksumSha256: 'd'.repeat(64),
          expiresAt: new Date(60_000).toISOString(),
        })),
        open: vi.fn(async () => ({
          ownerApp: 'video-maker_app',
          ownerProjectId: 'series-1',
          executionId: 'execution-1',
          attemptId: 'attempt-1',
          artifactRef: 'zx-temp:output-1',
          mimeType: 'video/mp4',
          sizeBytes: 4,
          checksumSha256: 'd'.repeat(64),
          expiresAt: new Date(60_000).toISOString(),
          body: stream([9, 8, 7, 6]),
        })),
        cleanupExpired: vi.fn(async () => 0),
      },
      recordProviderOutput: vi.fn(async () => undefined),
      recordOutputAuthorization: vi.fn(async () => undefined),
    });

    expect(readExactObject).toHaveBeenCalledWith(
      expect.objectContaining({
        storageObjectId: 'zs-start-object-1',
        readAuthorityRef: 'zs_read_grant_start_1',
      }),
      expect.any(AbortSignal),
    );
    expect(startRun).toHaveBeenCalledOnce();
    expect(observedInputBytes).toEqual([1, 2, 3, 4]);
    expect(result.media).toMatchObject({
      pendingResourceId: 'pending-video-resource-1',
      storageObjectId: 'zs-output-object-1',
      mimeType: 'video/mp4',
    });
  });
});
