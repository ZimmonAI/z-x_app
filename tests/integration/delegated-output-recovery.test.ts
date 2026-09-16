import { describe, expect, it, vi } from 'vitest';
import { AutoHubFixtureV1 } from '../../fixtures/v1/auto-hub.js';
import { ZAccountFixtureV1 } from '../../fixtures/v1/z-account.js';
import { ZProviderFixtureV1 } from '../../fixtures/v1/z-provider.js';
import { ZStorageFixtureV1 } from '../../fixtures/v1/z-s.js';
import { InMemoryTemporaryArtifactStore } from '../../src/artifacts/temporary.js';
import type {
  DelegatedOutputIntentV1,
  DelegatedOutputIntentResultV1,
  DelegatedOutputWriteV1,
  DelegatedStorageResultV1,
} from '../../src/clients/z-s.js';
import { SafeExecutionError } from '../../src/contracts/v1/error.js';
import { ExecutionResultV1Schema } from '../../src/contracts/v1/result.js';
import { ExecutionsRepository } from '../../src/persistence/repositories/executions.js';
import { claimNext } from '../../src/worker/claim.js';
import {
  completeClaimedExecution,
  prepareNextExecution,
  type FixtureDependencies,
} from '../../src/worker/lifecycle.js';
import { reconcileNextStorageCompletion } from '../../src/worker/reconciliation.js';
import { validRequest } from '../unit/test-request.js';
import { reset, testPool } from './db-helper.js';

const writeIntentId = '019a55c1-7ad0-7000-8000-000000000031';
const artifactBytes = new TextEncoder().encode('same-owner-generated-output');

class RetryOnceDelegatedStorage extends ZStorageFixtureV1 {
  readonly intents: Array<{
    writeAuthorizationRef: string;
    artifactRef: string;
    checksumSha256: string;
    sizeBytes: number;
  }> = [];
  readonly writes: Array<{
    writeIntentId: string;
    writeAuthorityRef: string;
    artifactRef: string;
    checksumSha256: string;
    sizeBytes: number;
  }> = [];

  override async createDelegatedOutputWriteIntent(
    input: DelegatedOutputIntentV1,
    _signal: AbortSignal,
  ): Promise<DelegatedOutputIntentResultV1> {
    this.intents.push({
      writeAuthorizationRef: input.writeAuthorizationRef,
      artifactRef: input.artifact.artifactRef,
      checksumSha256: input.artifact.checksumSha256,
      sizeBytes: input.artifact.sizeBytes,
    });
    return {
      writeIntentId,
      storageObjectId: `zs_object_${writeIntentId}`,
      uploadCompletionToken: `ephemeral_upload_${this.intents.length}`,
      expiresAt: new Date(60_000).toISOString(),
    };
  }

  override async writeDelegatedOutput(
    input: DelegatedOutputWriteV1,
    signal: AbortSignal,
  ): Promise<DelegatedStorageResultV1> {
    this.writes.push({
      writeIntentId: input.writeIntentId,
      writeAuthorityRef: input.writeAuthorityRef,
      artifactRef: input.artifact.artifactRef,
      checksumSha256: input.artifact.checksumSha256,
      sizeBytes: input.artifact.sizeBytes,
    });
    if (this.writes.length === 1) {
      throw new SafeExecutionError({
        family: 'storage-output-failure',
        code: 'ZX_Z_S_DELEGATED_WRITE_RETRYABLE_FAILURE',
        message: 'fixture delegated write failed retryably',
        retryable: true,
        traceId: 'delegated-output-recovery-test',
      });
    }
    return super.writeDelegatedOutput(input, signal);
  }
}

function delegatedImageRequest() {
  return {
    ...validRequest('image.generate.v1'),
    idempotencyKey: 'delegated-output-recovery-1',
    safeScalarInputs: {
      prompt: 'cinematic sunrise',
    },
    delegatedAuthorities: [
      {
        name: 'output.primary.write',
        reference: 'owner_output_write_capability_01',
      },
    ],
    ownerStorageAccess: {
      contractVersion: 'zx.owner-storage-access.v1',
      pendingResourceId: 'pending-owner-resource-1',
      outputWriteGrantRef: 'owner_output_write_capability_legacy_01',
      artifactKind: 'image',
      acceptedMimeTypes: ['image/png'],
      maxBytes: 1024,
    },
  };
}

describe('delegated output storage-only recovery', () => {
  it('retries Z-s from the same temporary artifact without repeating provider production', async () => {
    const pool = testPool();
    await reset(pool);

    const storage = new RetryOnceDelegatedStorage();
    const autoHub = new AutoHubFixtureV1();
    const startRun = vi.spyOn(autoHub, 'startRun');
    const getRun = vi.spyOn(autoHub, 'getRun');
    let materializations = 0;
    const temporaryArtifacts = new InMemoryTemporaryArtifactStore({
      createId: () => 'recovery-artifact-1',
      materialize: async (safeSourceRef) => {
        materializations += 1;
        expect(safeSourceRef).toBe('provider-output-fixture-0001');
        return {
          mimeType: 'image/png',
          body: new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(artifactBytes);
              controller.close();
            },
          }),
        };
      },
    });
    const dependencies: FixtureDependencies = {
      routes: new ZProviderFixtureV1(),
      capacity: new ZAccountFixtureV1(),
      autoHub,
      storage,
      temporaryArtifacts,
    };

    const submitted = await new ExecutionsRepository(pool).submit(delegatedImageRequest() as never);
    if (submitted.kind !== 'created') throw new Error('expected created execution');
    await expect(prepareNextExecution(pool, 'worker-prepare', 60, dependencies)).resolves.toBe(true);
    const claim = await claimNext(pool, 'worker-run');
    if (!claim) throw new Error('expected execution claim');

    await completeClaimedExecution(pool, claim, 'worker-run', dependencies);

    expect(startRun).toHaveBeenCalledTimes(1);
    expect(getRun).toHaveBeenCalledTimes(1);
    expect(materializations).toBe(1);
    expect(storage.intents).toHaveLength(1);
    expect(storage.writes).toHaveLength(1);

    const failedHandoff = await pool.query<{
      execution_status: string;
      attempt_status: string;
      external_run_ref: string | null;
      output_authorization_ref: string | null;
      safe_provider_output_ref: string | null;
    }>(
      `select e.status as execution_status, a.status as attempt_status,
              a.external_run_ref, a.output_authorization_ref, a.safe_provider_output_ref
         from execution.executions e
         join execution.execution_attempts a
           on a.execution_id=e.id and a.id=$2
        where e.id=$1`,
      [claim.executionId, claim.attemptId],
    );
    expect(failedHandoff.rows[0]).toMatchObject({
      execution_status: 'reconciliation-required',
      attempt_status: 'reconciliation-required',
      external_run_ref: 'run_fixture_0001',
      output_authorization_ref: writeIntentId,
      safe_provider_output_ref: 'zx-temp:recovery-artifact-1',
    });

    await expect(
      reconcileNextStorageCompletion(pool, 'worker-reconcile', 60, dependencies),
    ).resolves.toBe(true);

    expect(startRun).toHaveBeenCalledTimes(1);
    expect(getRun).toHaveBeenCalledTimes(1);
    expect(materializations).toBe(1);
    expect(storage.intents).toHaveLength(2);
    expect(storage.intents[1]).toEqual(storage.intents[0]);
    expect(storage.intents[0]).toMatchObject({
      writeAuthorizationRef: 'owner_output_write_capability_01',
      artifactRef: 'zx-temp:recovery-artifact-1',
      sizeBytes: artifactBytes.byteLength,
    });
    expect(storage.writes).toHaveLength(2);
    expect(storage.writes[0]).toMatchObject({
      writeIntentId,
      writeAuthorityRef: 'ephemeral_upload_1',
      artifactRef: 'zx-temp:recovery-artifact-1',
      sizeBytes: artifactBytes.byteLength,
    });
    expect(storage.writes[1]).toMatchObject({
      writeIntentId,
      writeAuthorityRef: 'ephemeral_upload_2',
      artifactRef: 'zx-temp:recovery-artifact-1',
      sizeBytes: artifactBytes.byteLength,
    });
    expect(storage.writes[1]?.checksumSha256).toBe(storage.writes[0]?.checksumSha256);

    const completed = await pool.query<{
      status: string;
      result_envelope: unknown;
    }>('select status, result_envelope from execution.executions where id=$1', [claim.executionId]);
    expect(completed.rows[0]?.status).toBe('succeeded');
    const result = ExecutionResultV1Schema.parse(completed.rows[0]?.result_envelope);
    expect(result.attemptId).toBe(claim.attemptId);
    expect(result.outputs).toEqual([
      expect.objectContaining({
        pendingResourceId: 'pending-owner-resource-1',
        storageObjectId: `zs_object_${writeIntentId}`,
        mimeType: 'image/png',
        sizeBytes: artifactBytes.byteLength,
      }),
    ]);

    await pool.end();
  });
});
