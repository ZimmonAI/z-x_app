import {
  BundleExecutionRequestV1Schema,
  BundleExecutionViewV1Schema,
  computeBundleExecutionRequestFingerprint,
  TemporaryArtifactDescriptorV1Schema,
} from '../../src/contracts/bundle-owner/v1/execution.js';

function material() {
  return {
    ownerType: 'app' as const,
    ownerRef: 'scene-video-generation-42',
    bundleVersionId: 'bundle-v1',
    inputs: {
      'prompt-text': [{ kind: 'value' as const, value: 'animate this scene' }],
      'beginning-frame-image': [
        {
          kind: 'resource' as const,
          resourceRef: 'resource-beginning-1',
          mimeType: 'image/png',
        },
      ],
      'ending-frame-image': [
        {
          kind: 'resource' as const,
          resourceRef: 'resource-ending-1',
          mimeType: 'image/png',
        },
      ],
    },
    correlation: { sceneVideoId: 'scene-video-42' },
  };
}

test('bundle owner request is manifest-keyed and fingerprintable', () => {
  const fingerprintMaterial = material();
  const request = {
    ...fingerprintMaterial,
    idempotencyKey: 'idem-42',
    requestFingerprint: computeBundleExecutionRequestFingerprint(fingerprintMaterial),
  };
  expect(BundleExecutionRequestV1Schema.parse(request)).toEqual(request);
});

test('fingerprint is stable across object key order', () => {
  const first = material();
  const second = {
    ...first,
    inputs: {
      'ending-frame-image': first.inputs['ending-frame-image'],
      'prompt-text': first.inputs['prompt-text'],
      'beginning-frame-image': first.inputs['beginning-frame-image'],
    },
    correlation: { sceneVideoId: 'scene-video-42' },
  };
  expect(computeBundleExecutionRequestFingerprint(first)).toBe(
    computeBundleExecutionRequestFingerprint(second),
  );
});

test('caller-controlled provider/runtime/step policy fields are rejected', () => {
  const fingerprintMaterial = material();
  const request = {
    ...fingerprintMaterial,
    idempotencyKey: 'idem-42',
    requestFingerprint: computeBundleExecutionRequestFingerprint(fingerprintMaterial),
    provider: 'leonardo',
    model: 'some-model',
    accountRef: 'account-1',
    profileRef: 'profile-1',
    runtimeNodeRef: 'node-1',
    stepId: 'step-submit',
    maxAttempts: 99,
    retryIntervalSeconds: 1,
  };
  expect(() => BundleExecutionRequestV1Schema.parse(request)).toThrow();
});

test('owner view contract excludes orchestration internals', () => {
  const view = {
    contractVersion: 'zx.bundle-owner.execution.v1' as const,
    executionId: 'execution-1',
    bundleVersionId: 'bundle-v1',
    ownerRef: 'scene-video-generation-42',
    state: 'running' as const,
    outputs: [],
    createdAt: '2026-09-14T08:00:00.000Z',
    updatedAt: '2026-09-14T08:00:01.000Z',
  };
  expect(BundleExecutionViewV1Schema.parse(view)).toEqual(view);
  expect(() =>
    BundleExecutionViewV1Schema.parse({
      ...view,
      currentStepId: 'step-submit',
      attemptId: 'attempt-1',
      runtimeNodeId: 'node-1',
      providerJobUrl: 'https://example.invalid/private',
    }),
  ).toThrow();
});

test('temporary artifact references are opaque and never raw paths or URLs', () => {
  const descriptor = {
    artifactRef: 'artifact-1',
    mimeType: 'video/mp4',
    sizeBytes: 123,
    checksumSha256: 'a'.repeat(64),
    expiresAt: '2026-09-14T09:00:00.000Z',
  };
  expect(TemporaryArtifactDescriptorV1Schema.parse(descriptor)).toEqual(descriptor);
  expect(() =>
    TemporaryArtifactDescriptorV1Schema.parse({
      ...descriptor,
      artifactRef: 'https://provider.example/private/video.mp4',
    }),
  ).toThrow();
});
