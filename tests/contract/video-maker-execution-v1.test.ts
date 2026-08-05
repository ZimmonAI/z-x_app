import { describe, expect, it } from 'vitest';
import {
  VIDEO_MAKER_EXECUTION_CONTRACT_VERSION,
  VIDEO_MAKER_OWNER_STORAGE_ACCESS_VERSION,
  VideoMakerExecutionRequestV1Schema,
  freezeVideoMakerExecutionRequestV1,
  type VideoMakerExecutionRequestV1,
} from '../../src/contracts/video-maker/v1/execution.js';
import { validateVideoMakerExecutionRequest } from '../../src/validation/video-maker-request.js';

function outputTargets(count: number) {
  return Array.from({ length: count }, (_, index) => ({
    pendingResourceId: `pending_${index + 1}`,
    outputWriteGrantRef: `write_grant_${index + 1}`,
  }));
}

function imageResource(id: string) {
  return {
    resourceId: id,
    storageObjectId: `storage_${id}`,
    readGrantRef: `read_grant_${id}`,
    kind: 'image' as const,
    mimeType: 'image/png',
  };
}

function textResource(id: string) {
  return {
    resourceId: id,
    storageObjectId: `storage_${id}`,
    readGrantRef: `read_grant_${id}`,
    kind: 'text' as const,
    mimeType: 'text/plain',
  };
}

function common(outputCount = 1) {
  return {
    contractVersion: VIDEO_MAKER_EXECUTION_CONTRACT_VERSION,
    ownerApp: 'video-maker_app' as const,
    ownerActionId: 'action_1',
    ownerProjectId: 'project_1',
    idempotencyKey: 'idempotency_1',
    traceId: 'trace_1',
    requestMode: 'initial' as const,
    frozenInputResources: [],
    ownerStorageAccess: {
      contractVersion: VIDEO_MAKER_OWNER_STORAGE_ACCESS_VERSION,
      outputTargets: outputTargets(outputCount),
    },
    retryPolicy: { maxAttempts: 3, backoffSeconds: 5 },
    timeoutPolicy: { executionSeconds: 900, phaseSeconds: 300 },
    priority: 5,
    correlation: { ownerJob: 'job_1' },
  };
}

type ConsumerRequest = Extract<VideoMakerExecutionRequestV1, { toolKey: 'consumer-gpt' }>;
type GoogleFlowRequest = Extract<VideoMakerExecutionRequestV1, { toolKey: 'google-flow' }>;

function validConsumerText(): ConsumerRequest {
  return freezeVideoMakerExecutionRequestV1({
    ...common(),
    toolKey: 'consumer-gpt',
    requestedOutput: { kind: 'text', mimeType: 'text/plain', count: 1 },
    toolParameters: {
      prompt: 'Write a concise scene description.',
      inputResourceRoles: [],
      outputKind: 'text',
      generationSettings: { temperature: 0.4 },
    },
  }) as ConsumerRequest;
}

function validConsumerImage(count: number): ConsumerRequest {
  const first = imageResource('image_1');
  const second = textResource('text_1');
  return freezeVideoMakerExecutionRequestV1({
    ...common(count),
    idempotencyKey: `idempotency_image_${count}`,
    frozenInputResources: [first, second],
    toolKey: 'consumer-gpt',
    requestedOutput: { kind: 'image', mimeType: 'image/png', count },
    toolParameters: {
      prompt: 'Create storyboard imagery.',
      inputResourceRoles: [
        { resourceId: first.resourceId, role: 'image' },
        { resourceId: second.resourceId, role: 'text' },
      ],
      outputKind: 'image',
      imageCount: count,
      generationSettings: { aspectRatio: '16:9', quality: 'high' },
    },
  }) as ConsumerRequest;
}

function validGoogleFlow(
  resources: ReturnType<typeof imageResource>[] = [],
  roles: unknown[] = [],
): GoogleFlowRequest {
  return freezeVideoMakerExecutionRequestV1({
    ...common(),
    idempotencyKey: `idempotency_flow_${resources.length}`,
    frozenInputResources: resources,
    toolKey: 'google-flow',
    requestedOutput: { kind: 'video', mimeType: 'video/mp4', count: 1 },
    toolParameters: {
      prompt: 'Animate the scene with a slow camera move.',
      imageResourceRoles: roles,
      generationSettings: { durationSeconds: 8, resolution: '1080p' },
      requestedVideoMimeType: 'video/mp4',
    },
  }) as GoogleFlowRequest;
}

describe('zx.video-maker.execution.v1', () => {
  it('accepts a valid initial Consumer GPT text request', () => {
    const request = validConsumerText();
    expect(request.toolKey).toBe('consumer-gpt');
    expect(request.requestedOutput).toEqual({ kind: 'text', mimeType: 'text/plain', count: 1 });
    expect(request.requestFingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(Object.isFrozen(request)).toBe(true);
    expect(Object.isFrozen(request.toolParameters)).toBe(true);
  });

  it('accepts a valid initial Consumer GPT single-image request', () => {
    expect(validConsumerImage(1).requestedOutput.count).toBe(1);
  });

  it('accepts a valid initial Consumer GPT multiple-image request', () => {
    expect(validConsumerImage(3).ownerStorageAccess.outputTargets).toHaveLength(3);
  });

  it('rejects text and image output semantics in one execution', () => {
    expect(() =>
      freezeVideoMakerExecutionRequestV1({
        ...common(),
        toolKey: 'consumer-gpt',
        requestedOutput: { kind: 'image', mimeType: 'image/png', count: 1 },
        toolParameters: {
          prompt: 'Describe the frame.',
          outputKind: 'text',
          imageCount: 1,
        },
      }),
    ).toThrow();
  });

  it('rejects image counts above the frozen bound', () => {
    expect(() => validConsumerImage(5)).toThrow();
  });

  it('accepts Google Flow without images', () => {
    expect(validGoogleFlow().toolParameters.imageResourceRoles).toEqual([]);
  });

  it('accepts Google Flow with a start image', () => {
    const start = imageResource('start_1');
    const request = validGoogleFlow([start], [{ resourceId: start.resourceId, role: 'start-image' }]);
    expect(request.frozenInputResources).toHaveLength(1);
  });

  it('accepts Google Flow with start and end images', () => {
    const start = imageResource('start_1');
    const end = imageResource('end_1');
    const request = validGoogleFlow(
      [start, end],
      [
        { resourceId: start.resourceId, role: 'start-image' },
        { resourceId: end.resourceId, role: 'end-image' },
      ],
    );
    expect(request.toolParameters.imageResourceRoles).toHaveLength(2);
  });

  it('rejects duplicate and unsupported Google Flow image roles', () => {
    const start = imageResource('start_1');
    const end = imageResource('end_1');
    expect(() =>
      validGoogleFlow(
        [start, end],
        [
          { resourceId: start.resourceId, role: 'start-image' },
          { resourceId: end.resourceId, role: 'start-image' },
        ],
      ),
    ).toThrow();
    expect(() => validGoogleFlow([start], [{ resourceId: start.resourceId, role: 'middle-image' }])).toThrow();
  });

  it('rejects unknown top-level fields', () => {
    const request = validConsumerText();
    expect(() => VideoMakerExecutionRequestV1Schema.parse({ ...request, provider: 'hidden-provider' })).toThrow();
  });

  it('rejects unknown tool-parameter fields', () => {
    const request = validConsumerText();
    expect(() =>
      VideoMakerExecutionRequestV1Schema.parse({
        ...request,
        toolParameters: { ...request.toolParameters, browserProfile: 'profile_1' },
      }),
    ).toThrow();
  });

  it('requires previousExecutionId for regeneration', () => {
    expect(() =>
      freezeVideoMakerExecutionRequestV1({
        ...common(),
        requestMode: 'regenerate',
        toolKey: 'consumer-gpt',
        requestedOutput: { kind: 'text', mimeType: 'text/plain', count: 1 },
        toolParameters: { prompt: 'Try again.', outputKind: 'text' },
      }),
    ).toThrow();
  });

  it('rejects previousExecutionId and feedback on initial requests', () => {
    for (const extra of [
      { previousExecutionId: '1f19e087-aebe-4b07-b6e4-39a4fc38311f' },
      { feedback: 'Make it warmer.' },
    ]) {
      expect(() =>
        freezeVideoMakerExecutionRequestV1({
          ...common(),
          ...extra,
          toolKey: 'consumer-gpt',
          requestedOutput: { kind: 'text', mimeType: 'text/plain', count: 1 },
          toolParameters: { prompt: 'Describe the scene.', outputKind: 'text' },
        }),
      ).toThrow();
    }
  });

  it('accepts bounded feedback only for regeneration', () => {
    const request = freezeVideoMakerExecutionRequestV1({
      ...common(),
      requestMode: 'regenerate',
      previousExecutionId: '1f19e087-aebe-4b07-b6e4-39a4fc38311f',
      feedback: 'Use gentler motion.',
      toolKey: 'consumer-gpt',
      requestedOutput: { kind: 'text', mimeType: 'text/plain', count: 1 },
      toolParameters: { prompt: 'Regenerate the scene.', outputKind: 'text' },
    });
    expect(request.feedback).toBe('Use gentler motion.');

    expect(() =>
      freezeVideoMakerExecutionRequestV1({
        ...common(),
        requestMode: 'regenerate',
        previousExecutionId: '1f19e087-aebe-4b07-b6e4-39a4fc38311f',
        feedback: 'x'.repeat(4097),
        toolKey: 'consumer-gpt',
        requestedOutput: { kind: 'text', mimeType: 'text/plain', count: 1 },
        toolParameters: { prompt: 'Regenerate.', outputKind: 'text' },
      }),
    ).toThrow();
  });

  it('rejects unsafe capability and storage references', () => {
    expect(() =>
      freezeVideoMakerExecutionRequestV1({
        ...common(),
        ownerStorageAccess: {
          contractVersion: VIDEO_MAKER_OWNER_STORAGE_ACCESS_VERSION,
          outputTargets: [
            { pendingResourceId: 'pending_1', outputWriteGrantRef: 'https://storage.example/upload' },
          ],
        },
        toolKey: 'consumer-gpt',
        requestedOutput: { kind: 'text', mimeType: 'text/plain', count: 1 },
        toolParameters: { prompt: 'Describe the scene.', outputKind: 'text' },
      }),
    ).toThrow();
  });

  it('rejects a fingerprint that does not cover the normalized frozen semantics', () => {
    const request = validConsumerText();
    expect(() =>
      validateVideoMakerExecutionRequest({ ...request, requestFingerprint: 'f'.repeat(64) }),
    ).toThrow();
  });

  it('canonicalizes object keys while preserving array order', () => {
    const first = validConsumerImage(2);
    const reordered = freezeVideoMakerExecutionRequestV1({
      correlation: { ownerJob: 'job_1' },
      priority: 5,
      timeoutPolicy: { phaseSeconds: 300, executionSeconds: 900 },
      retryPolicy: { backoffSeconds: 5, maxAttempts: 3 },
      ownerStorageAccess: {
        outputTargets: outputTargets(2),
        contractVersion: VIDEO_MAKER_OWNER_STORAGE_ACCESS_VERSION,
      },
      requestedOutput: { count: 2, mimeType: 'image/png', kind: 'image' },
      frozenInputResources: [imageResource('image_1'), textResource('text_1')],
      requestMode: 'initial',
      traceId: 'trace_1',
      idempotencyKey: 'idempotency_image_2',
      ownerProjectId: 'project_1',
      ownerActionId: 'action_1',
      ownerApp: 'video-maker_app',
      contractVersion: VIDEO_MAKER_EXECUTION_CONTRACT_VERSION,
      toolKey: 'consumer-gpt',
      toolParameters: {
        generationSettings: { quality: 'high', aspectRatio: '16:9' },
        imageCount: 2,
        outputKind: 'image',
        inputResourceRoles: [
          { role: 'image', resourceId: 'image_1' },
          { role: 'text', resourceId: 'text_1' },
        ],
        prompt: 'Create storyboard imagery.',
      },
    });
    expect(reordered.requestFingerprint).toBe(first.requestFingerprint);

    const reversedTargets = freezeVideoMakerExecutionRequestV1({
      ...first,
      ownerStorageAccess: {
        ...first.ownerStorageAccess,
        outputTargets: [...first.ownerStorageAccess.outputTargets].reverse(),
      },
    });
    expect(reversedTargets.requestFingerprint).not.toBe(first.requestFingerprint);
  });
});
