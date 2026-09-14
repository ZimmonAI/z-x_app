import type { AuthVerifier } from '../../src/api/auth.js';
import { buildServer } from '../../src/api/server.js';
import { MemoryBundleOwnerExecutionService } from '../../src/bundle-execution/v1/memory-service.js';
import {
  computeBundleExecutionRequestFingerprint,
  type BundleExecutionFingerprintMaterialV1,
} from '../../src/contracts/bundle-owner/v1/execution.js';
import { loadConfig } from '../../src/config.js';
import { catalogFixture } from '../unit/catalog-fixture.js';
import { validRequest } from '../unit/test-request.js';

const bundleScopes = new Set([
  'zx.bundle-executions.submit',
  'zx.bundle-executions.read',
  'zx.bundle-executions.artifacts.read',
  'zx.executions.submit',
  'zx.executions.read',
  'zx.executions.cancel',
  'zx.executions.retry',
  'zx.executions.reconcile',
]);

const verify: AuthVerifier = async (token) => ({
  ownerApp: token === 'owner-b' ? 'owner-b' : token === 'video-maker' ? 'video-maker' : 'owner-a',
  scopes: bundleScopes,
  payload: {},
});

const headersA = { authorization: 'Bearer owner-a' };
const headersB = { authorization: 'Bearer owner-b' };
const headersLegacy = { authorization: 'Bearer video-maker' };

function publishedFixture() {
  return catalogFixture({
    bundleStatus: 'published',
    scriptStatus: 'published',
    packageValidationStatus: 'valid',
    packageExecutable: true,
  });
}

function material(
  overrides: Partial<BundleExecutionFingerprintMaterialV1> = {},
): BundleExecutionFingerprintMaterialV1 {
  return {
    ownerType: 'app',
    ownerRef: 'scene-video-generation-42',
    bundleVersionId: 'bundle-v1',
    inputs: {
      'prompt-text': [{ kind: 'value', value: 'animate this scene' }],
      'beginning-frame-image': [
        {
          kind: 'resource',
          resourceRef: 'resource-beginning-1',
          mimeType: 'image/png',
        },
      ],
      'ending-frame-image': [
        {
          kind: 'resource',
          resourceRef: 'resource-ending-1',
          mimeType: 'image/png',
        },
      ],
    },
    correlation: { sceneVideoId: 'scene-video-42' },
    ...overrides,
  };
}

function request(
  overrides: Partial<BundleExecutionFingerprintMaterialV1> = {},
  idempotencyKey = 'idem-42',
) {
  const fingerprintMaterial = material(overrides);
  return {
    ...fingerprintMaterial,
    idempotencyKey,
    requestFingerprint: computeBundleExecutionRequestFingerprint(fingerprintMaterial),
  };
}

async function serverWith(service: MemoryBundleOwnerExecutionService) {
  return buildServer({
    config: loadConfig({ ZX_NODE_ENV: 'test' }),
    verify,
    bundleService: service,
  });
}

test('valid published bundle submit freezes exact immutable catalog graph', async () => {
  const { snapshot } = publishedFixture();
  const service = new MemoryBundleOwnerExecutionService(snapshot);
  const app = await serverWith(service);
  const response = await app.inject({
    method: 'POST',
    url: '/internal/v1/bundle-executions',
    headers: headersA,
    payload: request(),
  });
  expect(response.statusCode).toBe(202);
  const executionId = response.json().executionId as string;
  const frozen = service.frozenActivationForFixture(executionId);
  expect(frozen?.bundle.id).toBe('bundle-v1');
  expect(frozen?.bundle.releaseStatus).toBe('published');
  expect(frozen?.bundle.steps.map((step) => step.stepKey)).toEqual(['submit', 'completion-check']);
  expect(frozen?.scriptVersions.map((script) => script.releaseStatus)).toEqual([
    'published',
    'published',
  ]);
  expect(frozen?.runtimePackages.every((runtimePackage) => runtimePackage.executable)).toBe(true);
  await app.close();
});

test('unknown or unpublished bundle versions are rejected without reinterpretation', async () => {
  const published = publishedFixture();
  const publishedApp = await serverWith(new MemoryBundleOwnerExecutionService(published.snapshot));
  const unknown = await publishedApp.inject({
    method: 'POST',
    url: '/internal/v1/bundle-executions',
    headers: headersA,
    payload: request({ bundleVersionId: 'bundle-does-not-exist' }, 'idem-unknown'),
  });
  expect(unknown.statusCode).toBe(404);
  expect(unknown.json()).toEqual({ error: 'ZX_BUNDLE_NOT_FOUND' });
  await publishedApp.close();

  const draft = catalogFixture({
    bundleStatus: 'draft',
    scriptStatus: 'published',
    packageValidationStatus: 'valid',
    packageExecutable: true,
  });
  const draftApp = await serverWith(new MemoryBundleOwnerExecutionService(draft.snapshot));
  const unpublished = await draftApp.inject({
    method: 'POST',
    url: '/internal/v1/bundle-executions',
    headers: headersA,
    payload: request({}, 'idem-draft'),
  });
  expect(unpublished.statusCode).toBe(422);
  expect(unpublished.json()).toEqual({ error: 'ZX_BUNDLE_NOT_PUBLISHED' });
  await draftApp.close();
});

test('manifest cardinality, type, and request fingerprint are server-enforced', async () => {
  const { snapshot } = publishedFixture();
  const app = await serverWith(new MemoryBundleOwnerExecutionService(snapshot));

  const missingMaterial = material();
  delete missingMaterial.inputs['ending-frame-image'];
  const missing = {
    ...missingMaterial,
    idempotencyKey: 'idem-missing',
    requestFingerprint: computeBundleExecutionRequestFingerprint(missingMaterial),
  };
  expect(
    (
      await app.inject({
        method: 'POST',
        url: '/internal/v1/bundle-executions',
        headers: headersA,
        payload: missing,
      })
    ).statusCode,
  ).toBe(400);

  const wrongType = request(
    {
      inputs: {
        ...material().inputs,
        'beginning-frame-image': [
          { kind: 'resource', resourceRef: 'resource-beginning-1', mimeType: 'text/plain' },
        ],
      },
    },
    'idem-type',
  );
  expect(
    (
      await app.inject({
        method: 'POST',
        url: '/internal/v1/bundle-executions',
        headers: headersA,
        payload: wrongType,
      })
    ).statusCode,
  ).toBe(400);

  const wrongFingerprint = { ...request({}, 'idem-fingerprint'), requestFingerprint: '0'.repeat(64) };
  const fingerprintResponse = await app.inject({
    method: 'POST',
    url: '/internal/v1/bundle-executions',
    headers: headersA,
    payload: wrongFingerprint,
  });
  expect(fingerprintResponse.statusCode).toBe(400);
  expect(fingerprintResponse.json()).toEqual({ error: 'ZX_REQUEST_FINGERPRINT_MISMATCH' });
  await app.close();
});

test('owner-scoped idempotency returns the same execution or conflicts on a new fingerprint', async () => {
  const { snapshot } = publishedFixture();
  const app = await serverWith(new MemoryBundleOwnerExecutionService(snapshot));
  const first = await app.inject({
    method: 'POST',
    url: '/internal/v1/bundle-executions',
    headers: headersA,
    payload: request(),
  });
  const repeated = await app.inject({
    method: 'POST',
    url: '/internal/v1/bundle-executions',
    headers: headersA,
    payload: request(),
  });
  expect(first.statusCode).toBe(202);
  expect(repeated.statusCode).toBe(200);
  expect(repeated.json().executionId).toBe(first.json().executionId);

  const conflict = await app.inject({
    method: 'POST',
    url: '/internal/v1/bundle-executions',
    headers: headersA,
    payload: request({ ownerRef: 'scene-video-generation-43' }),
  });
  expect(conflict.statusCode).toBe(409);
  expect(conflict.json()).toEqual({ error: 'ZX_IDEMPOTENCY_CONFLICT' });
  await app.close();
});

test('owner read is isolated and terminal success/failure views remain normalized', async () => {
  const { snapshot } = publishedFixture();
  const service = new MemoryBundleOwnerExecutionService(snapshot);
  const app = await serverWith(service);
  const submitted = await app.inject({
    method: 'POST',
    url: '/internal/v1/bundle-executions',
    headers: headersA,
    payload: request(),
  });
  const executionId = submitted.json().executionId as string;

  expect(
    (
      await app.inject({
        method: 'GET',
        url: `/internal/v1/bundle-executions/${executionId}`,
        headers: headersB,
      })
    ).statusCode,
  ).toBe(404);

  service.completeForFixture(executionId, {
    'leonardo-generation-report': [{ kind: 'value', value: 'succeeded' }],
    'generated-video': [],
  });
  const terminal = await app.inject({
    method: 'GET',
    url: `/internal/v1/bundle-executions/${executionId}`,
    headers: headersA,
  });
  expect(terminal.statusCode).toBe(200);
  expect(terminal.json().state).toBe('succeeded');
  expect(terminal.json().outputs[0].manifestKey).toBe('leonardo-generation-report');
  const repeated = await app.inject({
    method: 'GET',
    url: `/internal/v1/bundle-executions/${executionId}`,
    headers: headersA,
  });
  expect(repeated.json()).toEqual(terminal.json());
  expect(JSON.stringify(terminal.json())).not.toMatch(
    /currentStep|attempt|lease|account|profile|runtimeNode|providerJob|filesystem|credential/i,
  );

  const second = await app.inject({
    method: 'POST',
    url: '/internal/v1/bundle-executions',
    headers: headersA,
    payload: request({ ownerRef: 'scene-video-generation-44' }, 'idem-failure'),
  });
  const failedId = second.json().executionId as string;
  service.failForFixture(failedId, 'PROVIDER_REPORTED_FAILURE', 'generation failed');
  const failed = await app.inject({
    method: 'GET',
    url: `/internal/v1/bundle-executions/${failedId}`,
    headers: headersA,
  });
  expect(failed.json()).toMatchObject({
    state: 'failed',
    failure: { code: 'PROVIDER_REPORTED_FAILURE', message: 'generation failed' },
    outputs: [],
  });
  await app.close();
});

test('forbidden routing controls are rejected and legacy execution v1 remains callable', async () => {
  const { snapshot } = publishedFixture();
  const app = await serverWith(new MemoryBundleOwnerExecutionService(snapshot));
  const payload = { ...request(), provider: 'leonardo', stepId: 'step-submit', maxAttempts: 99 };
  expect(
    (
      await app.inject({
        method: 'POST',
        url: '/internal/v1/bundle-executions',
        headers: headersA,
        payload,
      })
    ).statusCode,
  ).toBe(400);

  const legacy = await app.inject({
    method: 'POST',
    url: '/internal/v1/executions',
    headers: headersLegacy,
    payload: validRequest(),
  });
  expect(legacy.statusCode).toBe(202);
  await app.close();
});
