import type { AuthVerifier } from '../../src/api/auth.js';
import { buildServer } from '../../src/api/server.js';
import { MemoryBundleOwnerExecutionService } from '../../src/bundle-execution/v1/memory-service.js';
import {
  computeBundleExecutionRequestFingerprint,
  type BundleExecutionFingerprintMaterialV1,
} from '../../src/contracts/bundle-owner/v1/execution.js';
import { loadConfig } from '../../src/config.js';
import { catalogFixture } from '../unit/catalog-fixture.js';

const scopes = new Set([
  'zx.bundle-executions.submit',
  'zx.bundle-executions.read',
  'zx.bundle-executions.artifacts.read',
]);

const verify: AuthVerifier = async (token) => ({
  ownerApp: token === 'owner-b' ? 'owner-b' : 'owner-a',
  scopes,
  payload: {},
});

const headersA = { authorization: 'Bearer owner-a' };
const headersB = { authorization: 'Bearer owner-b' };

function publishedSnapshot() {
  return catalogFixture({
    bundleStatus: 'published',
    scriptStatus: 'published',
    packageValidationStatus: 'valid',
    packageExecutable: true,
  }).snapshot;
}

function request(ownerRef: string, idempotencyKey: string) {
  const material: BundleExecutionFingerprintMaterialV1 = {
    ownerType: 'app',
    ownerRef,
    bundleVersionId: 'bundle-v1',
    inputs: {
      'prompt-text': [{ kind: 'value', value: 'animate this scene' }],
      'beginning-frame-image': [
        { kind: 'resource', resourceRef: 'beginning-1', mimeType: 'image/png' },
      ],
      'ending-frame-image': [
        { kind: 'resource', resourceRef: 'ending-1', mimeType: 'image/png' },
      ],
    },
    correlation: {},
  };
  return {
    ...material,
    idempotencyKey,
    requestFingerprint: computeBundleExecutionRequestFingerprint(material),
  };
}

test('artifact retrieval enforces owner, execution relationship, metadata, bytes, and expiry', async () => {
  let clock = new Date('2026-09-14T08:00:00.000Z');
  const service = new MemoryBundleOwnerExecutionService(publishedSnapshot(), () => clock);
  const app = await buildServer({
    config: loadConfig({ ZX_NODE_ENV: 'test' }),
    verify,
    bundleService: service,
  });

  const submitted = await app.inject({
    method: 'POST',
    url: '/internal/v1/bundle-executions',
    headers: headersA,
    payload: request('scene-video-generation-1', 'idem-artifact-1'),
  });
  const executionId = submitted.json().executionId as string;
  const videoBytes = Buffer.from('bounded-video-bytes');
  const completed = service.completeForFixture(executionId, {
    'leonardo-generation-report': [{ kind: 'value', value: 'succeeded' }],
    'generated-video': [
      { kind: 'artifact', bytes: videoBytes, mimeType: 'video/mp4', fileNameHint: 'output.mp4' },
    ],
  });
  const videoOutput = completed.outputs.find((output) => output.manifestKey === 'generated-video');
  const artifactItem = videoOutput?.items[0];
  expect(artifactItem?.kind).toBe('temporary-artifact');
  if (!artifactItem || artifactItem.kind !== 'temporary-artifact') throw new Error('artifact missing');
  const artifactRef = artifactItem.artifact.artifactRef;

  const read = await app.inject({
    method: 'GET',
    url: `/internal/v1/bundle-executions/${executionId}/artifacts/${artifactRef}`,
    headers: headersA,
  });
  expect(read.statusCode).toBe(200);
  expect(read.rawPayload).toEqual(videoBytes);
  expect(read.headers['content-type']).toContain('video/mp4');
  expect(read.headers['content-length']).toBe(String(videoBytes.byteLength));
  expect(read.headers['x-zx-artifact-ref']).toBe(artifactRef);
  expect(read.headers['x-zx-checksum-sha256']).toBe(artifactItem.artifact.checksumSha256);

  const crossOwner = await app.inject({
    method: 'GET',
    url: `/internal/v1/bundle-executions/${executionId}/artifacts/${artifactRef}`,
    headers: headersB,
  });
  expect(crossOwner.statusCode).toBe(404);

  const otherExecution = await app.inject({
    method: 'POST',
    url: '/internal/v1/bundle-executions',
    headers: headersA,
    payload: request('scene-video-generation-2', 'idem-artifact-2'),
  });
  const unrelated = await app.inject({
    method: 'GET',
    url: `/internal/v1/bundle-executions/${otherExecution.json().executionId}/artifacts/${artifactRef}`,
    headers: headersA,
  });
  expect(unrelated.statusCode).toBe(404);

  clock = new Date('2026-09-14T08:06:00.000Z');
  const expired = await app.inject({
    method: 'GET',
    url: `/internal/v1/bundle-executions/${executionId}/artifacts/${artifactRef}`,
    headers: headersA,
  });
  expect(expired.statusCode).toBe(410);
  expect(expired.json()).toEqual({ error: 'ZX_ARTIFACT_EXPIRED' });
  await app.close();
});

test('cancel is intentionally absent and production default bundle runtime fails closed', async () => {
  const service = new MemoryBundleOwnerExecutionService(publishedSnapshot());
  const fixtureApp = await buildServer({
    config: loadConfig({ ZX_NODE_ENV: 'test' }),
    verify,
    bundleService: service,
  });
  const submitted = await fixtureApp.inject({
    method: 'POST',
    url: '/internal/v1/bundle-executions',
    headers: headersA,
    payload: request('scene-video-generation-3', 'idem-no-cancel'),
  });
  const noCancel = await fixtureApp.inject({
    method: 'POST',
    url: `/internal/v1/bundle-executions/${submitted.json().executionId}/cancel`,
    headers: headersA,
  });
  expect(noCancel.statusCode).toBe(404);
  await fixtureApp.close();

  const unavailableApp = await buildServer({
    config: loadConfig({ ZX_NODE_ENV: 'test' }),
    verify,
  });
  const unavailable = await unavailableApp.inject({
    method: 'POST',
    url: '/internal/v1/bundle-executions',
    headers: headersA,
    payload: request('scene-video-generation-4', 'idem-unavailable'),
  });
  expect(unavailable.statusCode).toBe(503);
  expect(unavailable.json()).toEqual({ error: 'service unavailable' });
  await unavailableApp.close();
});
