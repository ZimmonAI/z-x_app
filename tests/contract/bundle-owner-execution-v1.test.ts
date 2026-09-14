import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';
import { bundleExecutionRoutes } from '../../src/api/routes/bundle-executions.js';
import { MemoryBundleOwnerExecutionService } from '../../src/api/bundle-owner-execution-service.js';
import { BundleOwnerSubmitV1Schema } from '../../src/contracts/v1/bundle-owner.js';
import { catalogFixture } from '../unit/catalog-fixture.js';

function request(overrides: Record<string, unknown> = {}) {
  return {
    contractVersion: 'zx.bundle-owner.v1',
    ownerType: 'app',
    ownerRef: 'video:scene:42',
    bundleVersionId: 'bundle-v1',
    idempotencyKey: 'idem-1',
    requestFingerprint: 'a'.repeat(64),
    inputs: {
      prompt: [{ kind: 'value', value: 'Make the subject walk forward.' }],
      beginningFrame: [{ kind: 'artifact', artifactRef: 'owner-artifact:begin', mimeType: 'image/png' }],
      endingFrame: [{ kind: 'artifact', artifactRef: 'owner-artifact:end', mimeType: 'image/png' }],
    },
    correlation: { sceneId: 'scene-42' },
    ...overrides,
  };
}

function service() {
  const { snapshot } = catalogFixture({
    bundleStatus: 'published',
    scriptStatus: 'published',
    packageValidationStatus: 'valid',
    packageExecutable: true,
  });
  return new MemoryBundleOwnerExecutionService(snapshot);
}

describe('zx.bundle-owner.v1', () => {
  it('accepts one exact published immutable bundle and returns a stable execution identity', async () => {
    const target = service();
    const first = await target.submit('video-maker', request());
    const duplicate = await target.submit('video-maker', request());

    expect(first.code).toBe(202);
    expect(first.execution.state).toBe('accepted');
    expect(duplicate.code).toBe(200);
    expect(duplicate.execution.executionId).toBe(first.execution.executionId);
  });

  it('scopes idempotency by owner and conflicts on changed fingerprint', async () => {
    const target = service();
    const first = await target.submit('owner-a', request());
    const otherOwner = await target.submit('owner-b', request());

    expect(otherOwner.execution.executionId).not.toBe(first.execution.executionId);
    await expect(
      target.submit('owner-a', request({ requestFingerprint: 'b'.repeat(64) })),
    ).rejects.toMatchObject({ statusCode: 409 });
  });

  it('rejects unpublished/unknown bundles and malformed manifest-keyed inputs before activation', async () => {
    const unpublished = catalogFixture({
      bundleStatus: 'draft',
      scriptStatus: 'published',
      packageValidationStatus: 'valid',
      packageExecutable: true,
    });
    const draftService = new MemoryBundleOwnerExecutionService(unpublished.snapshot);

    await expect(draftService.submit('owner-a', request())).rejects.toMatchObject({ statusCode: 404 });
    await expect(service().submit('owner-a', request({ bundleVersionId: 'missing' }))).rejects.toMatchObject({ statusCode: 404 });
    await expect(
      service().submit(
        'owner-a',
        request({ inputs: { prompt: [], beginningFrame: [], endingFrame: [] } }),
      ),
    ).rejects.toMatchObject({ statusCode: 400 });
    await expect(
      service().submit(
        'owner-a',
        request({
          inputs: {
            prompt: [{ kind: 'artifact', artifactRef: 'wrong-kind' }],
            beginningFrame: [{ kind: 'artifact', artifactRef: 'begin', mimeType: 'image/png' }],
            endingFrame: [{ kind: 'artifact', artifactRef: 'end', mimeType: 'image/png' }],
          },
        }),
      ),
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  it('does not admit provider/model/account/profile/runtime or attempt controls into the caller contract', () => {
    for (const forbidden of [
      'provider',
      'model',
      'account',
      'profile',
      'runtimeNode',
      'stepId',
      'maxAttempts',
      'retryInterval',
    ]) {
      expect(() => BundleOwnerSubmitV1Schema.parse(request({ [forbidden]: 'forbidden' }))).toThrow();
    }
  });

  it('keeps reads/cancel owner-scoped and returns stable normalized terminal truth', async () => {
    const target = service();
    const accepted = await target.submit('owner-a', request());
    const id = accepted.execution.executionId;

    expect(await target.get('owner-b', id)).toBeNull();
    expect(await target.cancel('owner-b', id)).toBeNull();

    target.seedTerminalResultForTest({
      ownerApp: 'owner-a',
      executionId: id,
      state: 'succeeded',
      outputs: [{ usageKey: 'generationReport', ordinal: 0, value: { status: 'succeeded' } }],
    });
    const firstRead = await target.get('owner-a', id);
    const secondRead = await target.get('owner-a', id);

    expect(firstRead).toEqual(secondRead);
    expect(firstRead).toMatchObject({
      executionId: id,
      state: 'succeeded',
      outputs: [{ usageKey: 'generationReport', ordinal: 0 }],
    });
    expect(JSON.stringify(firstRead)).not.toMatch(/provider|account|profile|runtime_node|runtimeNode|attempt/i);
  });

  it('returns normalized terminal failure without leaking internals', async () => {
    const target = service();
    const accepted = await target.submit('owner-a', request());
    target.seedTerminalResultForTest({
      ownerApp: 'owner-a',
      executionId: accepted.execution.executionId,
      state: 'failed',
      failure: { code: 'execution-failed', message: 'The bundle execution did not complete.' },
    });

    expect(await target.get('owner-a', accepted.execution.executionId)).toMatchObject({
      state: 'failed',
      failure: { code: 'execution-failed' },
    });
  });

  it('authorizes bounded temporary artifacts by owner+execution and enforces expiry', async () => {
    const target = service();
    const accepted = await target.submit('owner-a', request());
    const executionId = accepted.execution.executionId;
    const artifactId = 'artifact-1';
    const expiresAt = new Date(Date.now() + 60_000).toISOString();
    const retrievalPath = `/v1/bundle-executions/${executionId}/artifacts/${artifactId}`;

    target.seedTerminalResultForTest({
      ownerApp: 'owner-a',
      executionId,
      state: 'succeeded',
      outputs: [{
        usageKey: 'generatedVideo',
        ordinal: 0,
        artifact: { artifactId, mimeType: 'video/mp4', sizeBytes: 3, expiresAt, retrievalPath },
      }],
    });
    target.seedArtifactForTest({
      ownerApp: 'owner-a',
      executionId,
      metadata: { artifactId, mimeType: 'video/mp4', sizeBytes: 3, expiresAt },
      bytes: new Uint8Array([1, 2, 3]),
    });

    expect(await target.retrieveArtifact('owner-b', executionId, artifactId)).toBeNull();
    expect(await target.retrieveArtifact('owner-a', executionId, artifactId)).toMatchObject({
      metadata: { artifactId, mimeType: 'video/mp4', sizeBytes: 3 },
    });

    target.seedArtifactForTest({
      ownerApp: 'owner-a',
      executionId,
      metadata: {
        artifactId: 'expired',
        mimeType: 'video/mp4',
        sizeBytes: 1,
        expiresAt: new Date(Date.now() - 1_000).toISOString(),
      },
      bytes: new Uint8Array([1]),
    });
    await expect(target.retrieveArtifact('owner-a', executionId, 'expired')).rejects.toMatchObject({ statusCode: 410 });
  });

  it('enforces auth scopes and cross-owner non-disclosure at the HTTP boundary', async () => {
    const target = service();
    const app = Fastify();
    await bundleExecutionRoutes(app, {
      service: target,
      verify: async (token) => ({
        ownerApp: token,
        scopes: new Set(['zx.executions.submit', 'zx.executions.read', 'zx.executions.cancel']),
        payload: {},
      }),
    });

    const submitted = await app.inject({
      method: 'POST',
      url: '/internal/v1/bundle-executions',
      headers: { authorization: 'Bearer owner-a' },
      payload: request(),
    });
    expect(submitted.statusCode).toBe(202);
    const body = submitted.json() as { executionId: string };

    const hidden = await app.inject({
      method: 'GET',
      url: `/internal/v1/bundle-executions/${body.executionId}`,
      headers: { authorization: 'Bearer owner-b' },
    });
    expect(hidden.statusCode).toBe(404);

    await app.close();
  });
});
