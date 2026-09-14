import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';
import { MemoryBundleOwnerExecutionService } from '../../src/api/bundle-owner-execution-service.js';
import { bundleArtifactRoutes } from '../../src/api/routes/bundle-artifacts.js';
import { catalogFixture } from '../unit/catalog-fixture.js';

function bundleRequest() {
  return {
    contractVersion: 'zx.bundle-owner.v1',
    ownerApp: 'video-maker',
    ownerActionId: 'scene-video-generation:artifact-test',
    bundleVersionId: 'bundle-v1',
    idempotencyKey: 'artifact-route-test',
    requestFingerprint: 'c'.repeat(64),
    manifestInputs: {
      prompt: [{ kind: 'value', value: 'test prompt' }],
      beginningFrame: [{ kind: 'artifact', artifactRef: 'owner-artifact:begin' }],
      endingFrame: [{ kind: 'artifact', artifactRef: 'owner-artifact:end' }],
    },
    correlation: {},
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

describe('bundle temporary artifact HTTP boundary', () => {
  it('streams only a visible non-expired artifact to its authenticated owner', async () => {
    const target = service();
    const accepted = await target.submit('video-maker', bundleRequest());
    const executionId = accepted.execution.executionId;
    const artifactId = 'video-output-1';
    const expiresAt = new Date(Date.now() + 60_000).toISOString();

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
            checksumSha256: 'd'.repeat(64),
            expiresAt,
            retrievalPath: `/internal/v1/executions/${executionId}/artifacts/${artifactId}`,
          },
        },
      ],
    });
    target.seedArtifactForTest({
      ownerApp: 'video-maker',
      executionId,
      metadata: {
        artifactId,
        mimeType: 'video/mp4',
        sizeBytes: 3,
        checksumSha256: 'd'.repeat(64),
        expiresAt,
      },
      bytes: new Uint8Array([1, 2, 3]),
    });

    const app = Fastify();
    await bundleArtifactRoutes(app, {
      service: target,
      verify: async (token) => ({
        ownerApp: token,
        scopes: new Set(['zx.executions.read']),
        payload: {},
      }),
    });

    const hidden = await app.inject({
      method: 'GET',
      url: `/internal/v1/executions/${executionId}/artifacts/${artifactId}`,
      headers: { authorization: 'Bearer other-owner' },
    });
    expect(hidden.statusCode).toBe(404);

    const response = await app.inject({
      method: 'GET',
      url: `/internal/v1/executions/${executionId}/artifacts/${artifactId}`,
      headers: { authorization: 'Bearer video-maker' },
    });
    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toContain('video/mp4');
    expect(response.headers['content-length']).toBe('3');
    expect(response.headers['x-zx-checksum-sha256']).toBe('d'.repeat(64));
    expect([...response.rawPayload]).toEqual([1, 2, 3]);

    await app.close();
  });
});
