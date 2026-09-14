import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';
import { BundleAwareExecutionService } from '../../src/api/bundle-aware-execution-service.js';
import { MemoryBundleOwnerExecutionService } from '../../src/api/bundle-owner-execution-service.js';
import { bundleArtifactRoutes } from '../../src/api/routes/bundle-artifacts.js';
import { executionRoutes, MemoryExecutionService } from '../../src/api/routes/executions.js';
import { BundleOwnerSubmitV1Schema } from '../../src/contracts/v1/bundle-owner.js';
import { catalogFixture } from '../unit/catalog-fixture.js';
import { validRequest } from '../unit/test-request.js';

function request(overrides: Record<string, unknown> = {}) {
  return {
    contractVersion: 'zx.bundle-owner.v1',
    ownerApp: 'video-maker',
    ownerActionId: 'scene-video-generation:42',
    ownerProjectId: 'video-project:7',
    bundleVersionId: 'bundle-v1',
    idempotencyKey: 'idem-1',
    requestFingerprint: 'a'.repeat(64),
    manifestInputs: {
      prompt: [{ kind: 'value', value: 'Make the subject walk forward.' }],
      beginningFrame: [
        {
          kind: 'artifact',
          artifactRef: 'owner-artifact:begin',
          capabilityRef: 'grant:begin',
          mimeType: 'image/png',
        },
      ],
      endingFrame: [
        {
          kind: 'artifact',
          artifactRef: 'owner-artifact:end',
          capabilityRef: 'grant:end',
          mimeType: 'image/png',
        },
      ],
    },
    correlation: { sceneId: 'scene-42' },
    traceId: 'trace-scene-42',
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

describe('zx.bundle-owner.v1 successor contract', () => {
  it('accepts one exact published immutable bundle and returns a stable execution identity', async () => {
    const target = service();
    const first = await target.submit('video-maker', request());
    const duplicate = await target.submit('video-maker', request());

    expect(first.code).toBe(202);
    expect(first.execution.status).toBe('accepted');
    expect(duplicate.code).toBe(200);
    expect(duplicate.execution.executionId).toBe(first.execution.executionId);
  });

  it('enforces authenticated owner identity and owner-scoped idempotency conflicts', async () => {
    const target = service();
    await expect(target.submit('owner-a', request())).rejects.toMatchObject({ statusCode: 403 });

    const ownerARequest = request({ ownerApp: 'owner-a' });
    const ownerBRequest = request({ ownerApp: 'owner-b' });
    const first = await target.submit('owner-a', ownerARequest);
    const otherOwner = await target.submit('owner-b', ownerBRequest);

    expect(otherOwner.execution.executionId).not.toBe(first.execution.executionId);
    await expect(
      target.submit(
        'owner-a',
        request({ ownerApp: 'owner-a', requestFingerprint: 'b'.repeat(64) }),
      ),
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

    await expect(draftService.submit('video-maker', request())).rejects.toMatchObject({
      statusCode: 404,
    });
    await expect(
      service().submit('video-maker', request({ bundleVersionId: 'missing' })),
    ).rejects.toMatchObject({ statusCode: 404 });
    await expect(
      service().submit(
        'video-maker',
        request({ manifestInputs: { prompt: [], beginningFrame: [], endingFrame: [] } }),
      ),
    ).rejects.toMatchObject({ statusCode: 400 });
    await expect(
      service().submit(
        'video-maker',
        request({
          manifestInputs: {
            prompt: [{ kind: 'artifact', artifactRef: 'wrong-kind' }],
            beginningFrame: [{ kind: 'artifact', artifactRef: 'begin', mimeType: 'image/png' }],
            endingFrame: [{ kind: 'artifact', artifactRef: 'end', mimeType: 'image/png' }],
          },
        }),
      ),
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  it('rejects old parallel-contract fields and caller-owned routing/runtime authority', () => {
    for (const forbidden of [
      'ownerType',
      'ownerRef',
      'inputs',
      'provider',
      'model',
      'account',
      'profile',
      'runtimeNode',
      'worker',
      'stepId',
      'attemptNumber',
      'maxAttempts',
      'retryInterval',
      'routeLocks',
    ]) {
      expect(() => BundleOwnerSubmitV1Schema.parse(request({ [forbidden]: 'forbidden' }))).toThrow();
    }
  });

  it('freezes exact bundle, manifests, scripts, bindings, policies and ordered execution steps', async () => {
    const target = service();
    const accepted = await target.submit('video-maker', request());
    const activation = target.inspectFrozenActivationForTest(
      'video-maker',
      accepted.execution.executionId,
    );

    expect(activation?.bundleVersion.id).toBe('bundle-v1');
    expect((activation?.manifestInputs.prompt ?? [])[0]).toEqual({
      kind: 'value',
      value: 'Make the subject walk forward.',
    });
    expect(activation?.manifestVersions.length).toBeGreaterThan(0);
    expect(activation?.scriptVersions.length).toBeGreaterThan(0);
    expect(activation?.runtimePackages.length).toBeGreaterThan(0);
    expect(activation?.stepInstances.length).toBeGreaterThan(0);
    expect(activation?.stepInstances.map((step) => step.stepOrder)).toEqual(
      [...(activation?.stepInstances ?? [])]
        .map((step) => step.stepOrder)
        .sort((left, right) => left - right),
    );
    expect(activation?.stepInstances.every((step) => step.policy.maxAttempts > 0)).toBe(true);
    expect(activation?.controlContract).toEqual(['DONE', 'POLLING', 'FAILED']);
  });

  it('keeps reads/cancel owner-scoped and returns stable normalized terminal truth', async () => {
    const target = service();
    const accepted = await target.submit('video-maker', request());
    const id = accepted.execution.executionId;

    expect(await target.get('other-owner', id)).toBeNull();
    expect(await target.cancel('other-owner', id)).toBeNull();

    target.seedTerminalResultForTest({
      ownerApp: 'video-maker',
      executionId: id,
      status: 'succeeded',
      outputs: [{ usageKey: 'generationReport', ordinal: 0, value: { status: 'succeeded' } }],
    });
    const firstRead = await target.get('video-maker', id);
    const secondRead = await target.get('video-maker', id);

    expect(firstRead).toEqual(secondRead);
    expect(firstRead).toMatchObject({
      executionId: id,
      status: 'succeeded',
      outputs: [{ usageKey: 'generationReport', ordinal: 0 }],
    });
    expect(JSON.stringify(firstRead)).not.toMatch(
      /provider|account|profile|runtime_node|runtimeNode|attempt|requestFingerprint|idempotency/i,
    );
  });

  it('returns normalized terminal failure without leaking internals', async () => {
    const target = service();
    const accepted = await target.submit('video-maker', request());
    target.seedTerminalResultForTest({
      ownerApp: 'video-maker',
      executionId: accepted.execution.executionId,
      status: 'failed',
      failure: { code: 'execution-failed', message: 'The bundle execution did not complete.' },
    });

    expect(await target.get('video-maker', accepted.execution.executionId)).toMatchObject({
      status: 'failed',
      failure: { code: 'execution-failed' },
    });
  });

  it('authorizes bounded temporary artifacts by visible owner output and enforces expiry', async () => {
    const target = service();
    const accepted = await target.submit('video-maker', request());
    const executionId = accepted.execution.executionId;
    const artifactId = 'artifact-1';
    const expiredArtifactId = 'expired';
    const expiresAt = new Date(Date.now() + 60_000).toISOString();
    const expiredAt = new Date(Date.now() - 1_000).toISOString();

    target.seedTerminalResultForTest({
      ownerApp: 'video-maker',
      executionId,
      status: 'succeeded',
      outputs: [
        {
          usageKey: 'generatedVideo',
          ordinal: 0,
          artifact: {
            artifactId,
            mimeType: 'video/mp4',
            sizeBytes: 3,
            expiresAt,
            retrievalPath: `/internal/v1/executions/${executionId}/artifacts/${artifactId}`,
          },
        },
        {
          usageKey: 'generatedVideo',
          ordinal: 1,
          artifact: {
            artifactId: expiredArtifactId,
            mimeType: 'video/mp4',
            sizeBytes: 1,
            expiresAt: expiredAt,
            retrievalPath: `/internal/v1/executions/${executionId}/artifacts/${expiredArtifactId}`,
          },
        },
      ],
    });
    target.seedArtifactForTest({
      ownerApp: 'video-maker',
      executionId,
      metadata: { artifactId, mimeType: 'video/mp4', sizeBytes: 3, expiresAt },
      bytes: new Uint8Array([1, 2, 3]),
    });
    target.seedArtifactForTest({
      ownerApp: 'video-maker',
      executionId,
      metadata: {
        artifactId: expiredArtifactId,
        mimeType: 'video/mp4',
        sizeBytes: 1,
        expiresAt: expiredAt,
      },
      bytes: new Uint8Array([1]),
    });

    expect(await target.retrieveArtifact('other-owner', executionId, artifactId)).toBeNull();
    expect(await target.retrieveArtifact('video-maker', executionId, 'unrelated')).toBeNull();
    expect(await target.retrieveArtifact('video-maker', executionId, artifactId)).toMatchObject({
      metadata: { artifactId, mimeType: 'video/mp4', sizeBytes: 3 },
    });
    await expect(
      target.retrieveArtifact('video-maker', executionId, expiredArtifactId),
    ).rejects.toMatchObject({ statusCode: 410 });
  });

  it('uses the existing execution routes for bundle and legacy contracts with cross-owner non-disclosure', async () => {
    const bundles = service();
    const combined = new BundleAwareExecutionService(new MemoryExecutionService(), bundles);
    const app = Fastify();
    const verify = async (token: string) => ({
      ownerApp: token,
      scopes: new Set([
        'zx.executions.submit',
        'zx.executions.read',
        'zx.executions.cancel',
        'zx.executions.retry',
        'zx.executions.reconcile',
      ]),
      payload: {},
    });
    await executionRoutes(app, { service: combined, verify });
    await bundleArtifactRoutes(app, { service: bundles, verify });

    const submitted = await app.inject({
      method: 'POST',
      url: '/internal/v1/executions',
      headers: { authorization: 'Bearer video-maker' },
      payload: request(),
    });
    expect(submitted.statusCode).toBe(202);
    const body = submitted.json() as { executionId: string; status: string };
    expect(body.status).toBe('accepted');

    const hidden = await app.inject({
      method: 'GET',
      url: `/internal/v1/executions/${body.executionId}`,
      headers: { authorization: 'Bearer other-owner' },
    });
    expect(hidden.statusCode).toBe(404);

    const legacy = await app.inject({
      method: 'POST',
      url: '/internal/v1/executions',
      headers: { authorization: 'Bearer video-maker' },
      payload: validRequest(),
    });
    expect(legacy.statusCode).toBe(202);
    expect(legacy.json()).toMatchObject({ ownerApp: 'video-maker', status: 'accepted' });

    await app.close();
  });
});
