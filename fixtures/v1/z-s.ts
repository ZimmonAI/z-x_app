import { createHash } from 'node:crypto';
import type { ZStorageClient } from '../../src/clients/z-s.js';
import type {
  CreateOutputAuthorizationV1,
  CompleteOutputV1,
  CreateReadGrantV1,
  OutputAuthorizationV1,
  StorageResultV1,
  ReadGrantV1,
  ReconcileOutputV1,
  OutputReconciliationV1,
} from '../../src/contracts/v1/dependencies.js';
import {
  parseOutputReconciliationV1,
  parseReconcileOutputV1,
} from '../../src/contracts/v1/dependencies.js';
import { SafeExecutionError } from '../../src/contracts/v1/error.js';

function stableStorageResult(input: ReconcileOutputV1): StorageResultV1 {
  const digest = createHash('sha256')
    .update(
      [
        input.executionId,
        input.attemptId,
        input.authorizationRef,
        input.safeProviderOutputRef,
        input.mimeType,
      ].join('\u0000'),
    )
    .digest('hex');
  const video = input.mimeType.startsWith('video/');
  const resourceId = `resource_fixture_${digest.slice(0, 16)}`;
  const resourceVersionId = `version_fixture_${digest.slice(16, 32)}`;
  return {
    resourceId,
    resourceVersionId,
    storageIdentity: `zs://fixture/${resourceId}/${resourceVersionId}`,
    checksumSha256: digest,
    mimeType: input.mimeType,
    sizeBytes: video ? 1024 : 512,
    width: 1024,
    height: 1024,
    ...(video ? { durationSeconds: 5 } : {}),
  };
}

export class ZStorageFixtureV1 implements ZStorageClient {
  readonly fixtureVersion = 'fixture-v1';

  async createOutputAuthorization(
    input: CreateOutputAuthorizationV1,
    _signal: AbortSignal,
  ): Promise<OutputAuthorizationV1> {
    if (input.mode === 'direct-write') {
      throw new SafeExecutionError({
        family: 'adapter-unavailable',
        code: 'ZX_DIRECT_WRITE_UNSUPPORTED',
        message: 'fixture direct-write is unsupported',
        retryable: false,
        traceId: 'fixture',
      });
    }
    return {
      authorizationRef: `outauth_${input.executionId}_${input.attemptId}`,
      uploadRef: `upload_${input.attemptId}`,
      expiresAt: new Date(60000).toISOString(),
    };
  }

  async completeOrIngestOutput(
    input: CompleteOutputV1,
    _signal: AbortSignal,
  ): Promise<StorageResultV1> {
    if (input.fixtureScenario === 'storage-failure') {
      throw new SafeExecutionError({
        family: 'storage-output-failure',
        code: 'ZX_STORAGE_FAILURE',
        message: 'fixture storage failure',
        retryable: true,
        traceId: 'fixture',
      });
    }
    const video = input.mimeType.startsWith('video/');
    return {
      resourceId: 'resource_fixture_0001',
      resourceVersionId: 'version_fixture_0001',
      storageIdentity: 'zs://fixture/resource_fixture_0001/version_fixture_0001',
      checksumSha256: 'c'.repeat(64),
      mimeType: input.mimeType,
      sizeBytes: video ? 1024 : 512,
      width: 1024,
      height: 1024,
      ...(video ? { durationSeconds: 5 } : {}),
    };
  }

  async reconcileOutput(
    value: ReconcileOutputV1,
    _signal: AbortSignal,
  ): Promise<OutputReconciliationV1> {
    const input = parseReconcileOutputV1(value);
    const result: OutputReconciliationV1 = (() => {
      switch (input.fixtureScenario) {
        case 'storage-reconciliation-pending':
          return { status: 'pending', retryAfterSeconds: 30 };
        case 'storage-failure':
        case 'storage-reconciliation-retryable-failure':
          return {
            status: 'failed',
            errorCode: 'ZX_STORAGE_RECONCILIATION_RETRYABLE',
            retryable: true,
          };
        case 'storage-reconciliation-terminal-failure':
          return {
            status: 'failed',
            errorCode: 'ZX_STORAGE_RECONCILIATION_TERMINAL',
            retryable: false,
          };
        default:
          return { status: 'completed', result: stableStorageResult(input) };
      }
    })();
    return parseOutputReconciliationV1(result);
  }

  async createReadGrant(input: CreateReadGrantV1, _signal: AbortSignal): Promise<ReadGrantV1> {
    return {
      readGrantRef: `read_${input.resourceId}`,
      expiresAt: new Date(60000).toISOString(),
    };
  }
}
