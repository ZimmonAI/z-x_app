import { createHash } from 'node:crypto';
import { z } from 'zod';
import { isOpaqueOwnerCapabilityReference } from '../../v1/execution.js';

export const VIDEO_MAKER_EXECUTION_CONTRACT_VERSION = 'zx.video-maker.execution.v1' as const;
export const VIDEO_MAKER_OWNER_STORAGE_ACCESS_VERSION =
  'zx.video-maker.owner-storage-access.v1' as const;

export const VIDEO_MAKER_TOOL_KEYS = ['consumer-gpt', 'google-flow'] as const;
export const VIDEO_MAKER_REQUEST_MODES = ['initial', 'regenerate'] as const;
export const VIDEO_MAKER_IMAGE_MIME_TYPES = ['image/png', 'image/jpeg', 'image/webp'] as const;
export const VIDEO_MAKER_VIDEO_MIME_TYPES = ['video/mp4', 'video/webm'] as const;
export const VIDEO_MAKER_MAX_INPUT_RESOURCES = 16;
export const VIDEO_MAKER_MAX_IMAGE_OUTPUTS = 4;
export const VIDEO_MAKER_MAX_OUTPUT_TARGETS = 4;
export const VIDEO_MAKER_MAX_PROMPT_BYTES = 32_768;
export const VIDEO_MAKER_MAX_FEEDBACK_BYTES = 8_192;

function hasNoForbiddenControlCharacters(value: string): boolean {
  return Array.from(value).every((character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint >= 32 || codePoint === 9 || codePoint === 10 || codePoint === 13;
  });
}

function isBoundedUtf8(value: string, maximumBytes: number): boolean {
  return Buffer.byteLength(value, 'utf8') <= maximumBytes;
}

function hasUniqueValues(values: readonly string[]): boolean {
  return new Set(values).size === values.length;
}

const boundedIdentifier = z
  .string()
  .min(1)
  .max(256)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/, 'identifier must be opaque');

const boundedOpaqueReference = z
  .string()
  .min(1)
  .max(512)
  .refine(isOpaqueOwnerCapabilityReference, 'reference must be opaque');

const boundedSafeText = (maximumCharacters: number, maximumBytes: number) =>
  z
    .string()
    .min(1)
    .max(maximumCharacters)
    .refine((value) => value.trim().length > 0, 'text must not be blank')
    .refine(hasNoForbiddenControlCharacters, 'control characters prohibited')
    .refine((value) => isBoundedUtf8(value, maximumBytes), `text exceeds ${maximumBytes} UTF-8 bytes`);

const promptText = boundedSafeText(VIDEO_MAKER_MAX_PROMPT_BYTES, VIDEO_MAKER_MAX_PROMPT_BYTES);
const feedbackText = boundedSafeText(4096, VIDEO_MAKER_MAX_FEEDBACK_BYTES);
const safeHintText = boundedSafeText(1024, 2048);
const safeMimeType = z.string().regex(/^[a-z][a-z0-9.+-]*\/[a-z0-9][a-z0-9.+-]*$/);

export const VideoMakerFrozenInputResourceV1Schema = z
  .object({
    resourceId: boundedIdentifier,
    storageObjectId: boundedOpaqueReference,
    readGrantRef: boundedOpaqueReference,
    kind: z.enum(['image', 'text']),
    mimeType: safeMimeType,
    checksumSha256: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  })
  .strict()
  .superRefine((resource, context) => {
    if (resource.kind === 'image' && !resource.mimeType.startsWith('image/')) {
      context.addIssue({
        code: 'custom',
        path: ['mimeType'],
        message: 'ZX_VM_IMAGE_RESOURCE_MIME_REQUIRED',
      });
    }
    if (resource.kind === 'text' && !resource.mimeType.startsWith('text/')) {
      context.addIssue({
        code: 'custom',
        path: ['mimeType'],
        message: 'ZX_VM_TEXT_RESOURCE_MIME_REQUIRED',
      });
    }
  });

export const VideoMakerOutputTargetV1Schema = z
  .object({
    pendingResourceId: boundedIdentifier,
    outputWriteGrantRef: boundedOpaqueReference,
  })
  .strict();

export const VideoMakerOwnerStorageAccessV1Schema = z
  .object({
    contractVersion: z.literal(VIDEO_MAKER_OWNER_STORAGE_ACCESS_VERSION),
    outputTargets: z
      .array(VideoMakerOutputTargetV1Schema)
      .min(1)
      .max(VIDEO_MAKER_MAX_OUTPUT_TARGETS)
      .refine(
        (targets) => hasUniqueValues(targets.map((target) => target.pendingResourceId)),
        'pendingResourceId values must be unique',
      )
      .refine(
        (targets) => hasUniqueValues(targets.map((target) => target.outputWriteGrantRef)),
        'outputWriteGrantRef values must be unique',
      ),
  })
  .strict();

export const VideoMakerRequestedOutputV1Schema = z
  .object({
    kind: z.enum(['text', 'image', 'video']),
    mimeType: safeMimeType,
    count: z.number().int().min(1).max(VIDEO_MAKER_MAX_IMAGE_OUTPUTS),
    maxBytesPerOutput: z.number().int().positive().safe().optional(),
  })
  .strict();

const ConsumerGptInputRoleV1Schema = z
  .object({
    resourceId: boundedIdentifier,
    role: z.enum(['image', 'text']),
  })
  .strict();

const ConsumerGptGenerationSettingsV1Schema = z
  .object({
    temperature: z.number().min(0).max(2).optional(),
    seed: z.number().int().min(0).max(2_147_483_647).optional(),
    styleHint: safeHintText.optional(),
    aspectRatio: z.enum(['1:1', '4:3', '3:4', '16:9', '9:16']).optional(),
    quality: z.enum(['standard', 'high']).optional(),
  })
  .strict();

export const ConsumerGptToolParametersV1Schema = z
  .object({
    prompt: promptText,
    inputResourceRoles: z
      .array(ConsumerGptInputRoleV1Schema)
      .max(VIDEO_MAKER_MAX_INPUT_RESOURCES)
      .refine(
        (roles) => hasUniqueValues(roles.map((role) => role.resourceId)),
        'consumer-gpt resource roles must be unique',
      )
      .default([]),
    outputKind: z.enum(['text', 'image']),
    imageCount: z.number().int().min(1).max(VIDEO_MAKER_MAX_IMAGE_OUTPUTS).optional(),
    generationSettings: ConsumerGptGenerationSettingsV1Schema.default({}),
  })
  .strict()
  .superRefine((parameters, context) => {
    if (parameters.outputKind === 'text') {
      if (parameters.imageCount !== undefined) {
        context.addIssue({
          code: 'custom',
          path: ['imageCount'],
          message: 'ZX_VM_TEXT_OUTPUT_REJECTS_IMAGE_COUNT',
        });
      }
      if (
        parameters.generationSettings.aspectRatio !== undefined ||
        parameters.generationSettings.quality !== undefined
      ) {
        context.addIssue({
          code: 'custom',
          path: ['generationSettings'],
          message: 'ZX_VM_TEXT_OUTPUT_REJECTS_IMAGE_SETTINGS',
        });
      }
    }
    if (parameters.outputKind === 'image' && parameters.imageCount === undefined) {
      context.addIssue({
        code: 'custom',
        path: ['imageCount'],
        message: 'ZX_VM_IMAGE_OUTPUT_REQUIRES_IMAGE_COUNT',
      });
    }
  });

const GoogleFlowImageRoleV1Schema = z
  .object({
    resourceId: boundedIdentifier,
    role: z.enum(['start-image', 'end-image']),
  })
  .strict();

const GoogleFlowGenerationSettingsV1Schema = z
  .object({
    durationSeconds: z.number().int().min(1).max(30).optional(),
    aspectRatio: z.enum(['16:9', '9:16', '1:1']).optional(),
    resolution: z.enum(['720p', '1080p']).optional(),
    seed: z.number().int().min(0).max(2_147_483_647).optional(),
    motionGuidance: safeHintText.optional(),
  })
  .strict();

export const GoogleFlowToolParametersV1Schema = z
  .object({
    prompt: promptText,
    imageResourceRoles: z
      .array(GoogleFlowImageRoleV1Schema)
      .max(2)
      .refine(
        (roles) => hasUniqueValues(roles.map((role) => role.resourceId)),
        'google-flow resource references must be unique',
      )
      .refine(
        (roles) => hasUniqueValues(roles.map((role) => role.role)),
        'google-flow image roles must be unique',
      )
      .default([]),
    generationSettings: GoogleFlowGenerationSettingsV1Schema.default({}),
    requestedVideoMimeType: z.enum(VIDEO_MAKER_VIDEO_MIME_TYPES),
  })
  .strict();

const RetryPolicyV1Schema = z
  .object({
    maxAttempts: z.number().int().min(1).max(5).default(3),
    backoffSeconds: z.number().int().min(1).max(300).default(5),
  })
  .strict()
  .default({ maxAttempts: 3, backoffSeconds: 5 });

const TimeoutPolicyV1Schema = z
  .object({
    executionSeconds: z.number().int().min(30).max(3600).default(900),
    phaseSeconds: z.number().int().min(30).max(900).default(300),
  })
  .strict()
  .default({ executionSeconds: 900, phaseSeconds: 300 })
  .refine((policy) => policy.phaseSeconds <= policy.executionSeconds, {
    message: 'phaseSeconds must not exceed executionSeconds',
    path: ['phaseSeconds'],
  });

const correlationKey = z.string().min(1).max(64).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/);
const correlationValue = z
  .string()
  .min(1)
  .max(256)
  .refine(hasNoForbiddenControlCharacters, 'control characters prohibited');
const CorrelationV1Schema = z
  .record(correlationKey, correlationValue)
  .refine((correlation) => Object.keys(correlation).length <= 16, 'correlation supports at most 16 entries')
  .default({});

const commonRequestFields = {
  contractVersion: z.literal(VIDEO_MAKER_EXECUTION_CONTRACT_VERSION),
  ownerApp: z.literal('video-maker_app'),
  ownerActionId: boundedIdentifier,
  ownerProjectId: boundedIdentifier.optional(),
  idempotencyKey: boundedIdentifier,
  requestFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  traceId: boundedIdentifier,
  requestMode: z.enum(VIDEO_MAKER_REQUEST_MODES),
  previousExecutionId: z.string().uuid().optional(),
  feedback: feedbackText.optional(),
  frozenInputResources: z.array(VideoMakerFrozenInputResourceV1Schema).max(VIDEO_MAKER_MAX_INPUT_RESOURCES),
  ownerStorageAccess: VideoMakerOwnerStorageAccessV1Schema,
  requestedOutput: VideoMakerRequestedOutputV1Schema,
  retryPolicy: RetryPolicyV1Schema,
  timeoutPolicy: TimeoutPolicyV1Schema,
  priority: z.number().int().min(0).max(9).default(5),
  correlation: CorrelationV1Schema,
} as const;

const ConsumerGptRequestV1Schema = z
  .object({
    ...commonRequestFields,
    toolKey: z.literal('consumer-gpt'),
    toolParameters: ConsumerGptToolParametersV1Schema,
  })
  .strict();

const GoogleFlowRequestV1Schema = z
  .object({
    ...commonRequestFields,
    toolKey: z.literal('google-flow'),
    toolParameters: GoogleFlowToolParametersV1Schema,
  })
  .strict();

function addCustomIssue(context: z.RefinementCtx, path: (string | number)[], message: string): void {
  context.addIssue({ code: 'custom', path, message });
}

function validateCommonRequestSemantics(
  request: z.infer<typeof ConsumerGptRequestV1Schema> | z.infer<typeof GoogleFlowRequestV1Schema>,
  context: z.RefinementCtx,
): void {
  if (request.requestMode === 'initial') {
    if (request.previousExecutionId !== undefined) {
      addCustomIssue(context, ['previousExecutionId'], 'ZX_VM_INITIAL_REJECTS_PREVIOUS_EXECUTION');
    }
    if (request.feedback !== undefined) {
      addCustomIssue(context, ['feedback'], 'ZX_VM_INITIAL_REJECTS_FEEDBACK');
    }
  }
  if (request.requestMode === 'regenerate' && request.previousExecutionId === undefined) {
    addCustomIssue(context, ['previousExecutionId'], 'ZX_VM_REGENERATION_REQUIRES_PREVIOUS_EXECUTION');
  }

  const resourceIds = request.frozenInputResources.map((resource) => resource.resourceId);
  if (!hasUniqueValues(resourceIds)) {
    addCustomIssue(context, ['frozenInputResources'], 'ZX_VM_INPUT_RESOURCE_IDS_MUST_BE_UNIQUE');
  }
  const storageObjectIds = request.frozenInputResources.map((resource) => resource.storageObjectId);
  if (!hasUniqueValues(storageObjectIds)) {
    addCustomIssue(context, ['frozenInputResources'], 'ZX_VM_STORAGE_OBJECT_IDS_MUST_BE_UNIQUE');
  }

  if (request.ownerStorageAccess.outputTargets.length !== request.requestedOutput.count) {
    addCustomIssue(context, ['ownerStorageAccess', 'outputTargets'], 'ZX_VM_OUTPUT_TARGET_COUNT_MISMATCH');
  }
}

function validateConsumerGptSemantics(
  request: z.infer<typeof ConsumerGptRequestV1Schema>,
  context: z.RefinementCtx,
): void {
  if (request.toolParameters.outputKind !== request.requestedOutput.kind) {
    addCustomIssue(context, ['requestedOutput', 'kind'], 'ZX_VM_CONSUMER_OUTPUT_KIND_MISMATCH');
  }

  if (request.toolParameters.outputKind === 'text') {
    if (request.requestedOutput.mimeType !== 'text/plain' || request.requestedOutput.count !== 1) {
      addCustomIssue(context, ['requestedOutput'], 'ZX_VM_TEXT_OUTPUT_MUST_BE_SINGLE_TEXT_PLAIN');
    }
  } else {
    if (!(VIDEO_MAKER_IMAGE_MIME_TYPES as readonly string[]).includes(request.requestedOutput.mimeType)) {
      addCustomIssue(context, ['requestedOutput', 'mimeType'], 'ZX_VM_IMAGE_OUTPUT_MIME_UNSUPPORTED');
    }
    if (request.requestedOutput.count !== request.toolParameters.imageCount) {
      addCustomIssue(context, ['requestedOutput', 'count'], 'ZX_VM_IMAGE_OUTPUT_COUNT_MISMATCH');
    }
  }

  const resources = new Map(
    request.frozenInputResources.map((resource) => [resource.resourceId, resource] as const),
  );
  for (const [index, role] of request.toolParameters.inputResourceRoles.entries()) {
    const resource = resources.get(role.resourceId);
    if (!resource) {
      addCustomIssue(context, ['toolParameters', 'inputResourceRoles', index, 'resourceId'], 'ZX_VM_INPUT_RESOURCE_NOT_FROZEN');
      continue;
    }
    if (resource.kind !== role.role) {
      addCustomIssue(context, ['toolParameters', 'inputResourceRoles', index, 'role'], 'ZX_VM_INPUT_RESOURCE_ROLE_KIND_MISMATCH');
    }
  }
  if (request.toolParameters.inputResourceRoles.length !== request.frozenInputResources.length) {
    addCustomIssue(context, ['toolParameters', 'inputResourceRoles'], 'ZX_VM_ALL_FROZEN_INPUTS_REQUIRE_ROLES');
  }
}

function validateGoogleFlowSemantics(
  request: z.infer<typeof GoogleFlowRequestV1Schema>,
  context: z.RefinementCtx,
): void {
  if (
    request.requestedOutput.kind !== 'video' ||
    request.requestedOutput.count !== 1 ||
    request.requestedOutput.mimeType !== request.toolParameters.requestedVideoMimeType
  ) {
    addCustomIssue(context, ['requestedOutput'], 'ZX_VM_GOOGLE_FLOW_REQUIRES_SINGLE_MATCHING_VIDEO');
  }

  const resources = new Map(
    request.frozenInputResources.map((resource) => [resource.resourceId, resource] as const),
  );
  for (const [index, role] of request.toolParameters.imageResourceRoles.entries()) {
    const resource = resources.get(role.resourceId);
    if (!resource) {
      addCustomIssue(context, ['toolParameters', 'imageResourceRoles', index, 'resourceId'], 'ZX_VM_INPUT_RESOURCE_NOT_FROZEN');
      continue;
    }
    if (resource.kind !== 'image') {
      addCustomIssue(context, ['toolParameters', 'imageResourceRoles', index, 'role'], 'ZX_VM_GOOGLE_FLOW_ROLE_REQUIRES_IMAGE');
    }
  }
  if (request.toolParameters.imageResourceRoles.length !== request.frozenInputResources.length) {
    addCustomIssue(context, ['toolParameters', 'imageResourceRoles'], 'ZX_VM_ALL_FROZEN_INPUTS_REQUIRE_ROLES');
  }
}

export const VideoMakerExecutionRequestV1SemanticSchema = z
  .discriminatedUnion('toolKey', [ConsumerGptRequestV1Schema, GoogleFlowRequestV1Schema])
  .superRefine((request, context) => {
    validateCommonRequestSemantics(request, context);
    if (request.toolKey === 'consumer-gpt') validateConsumerGptSemantics(request, context);
    else validateGoogleFlowSemantics(request, context);
  });

function canonicalizeJson(value: unknown): string {
  if (value === null) return 'null';
  if (typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError('canonical JSON rejects non-finite numbers');
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalizeJson).join(',')}]`;
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record)
      .filter((key) => record[key] !== undefined)
      .sort();
    return `{${keys
      .map((key) => `${JSON.stringify(key)}:${canonicalizeJson(record[key])}`)
      .join(',')}}`;
  }
  throw new TypeError(`canonical JSON rejects ${typeof value}`);
}

export function canonicalizeVideoMakerExecutionRequestV1(
  request: z.infer<typeof VideoMakerExecutionRequestV1SemanticSchema>,
): string {
  const semantics = { ...(request as unknown as Record<string, unknown>) };
  delete semantics.requestFingerprint;
  return canonicalizeJson(semantics);
}

export function computeVideoMakerRequestFingerprintV1(
  request: z.infer<typeof VideoMakerExecutionRequestV1SemanticSchema>,
): string {
  return createHash('sha256')
    .update(canonicalizeVideoMakerExecutionRequestV1(request), 'utf8')
    .digest('hex');
}

export const VideoMakerExecutionRequestV1Schema = VideoMakerExecutionRequestV1SemanticSchema.superRefine(
  (request, context) => {
    const expected = computeVideoMakerRequestFingerprintV1(request);
    if (request.requestFingerprint !== expected) {
      addCustomIssue(context, ['requestFingerprint'], 'ZX_VM_REQUEST_FINGERPRINT_MISMATCH');
    }
  },
);

function deepFreezeValue<T>(value: T): T {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value as Record<string, unknown>)) deepFreezeValue(child);
  return Object.freeze(value) as T;
}

export function freezeAcceptedVideoMakerExecutionRequestV1(
  request: z.infer<typeof VideoMakerExecutionRequestV1Schema>,
): VideoMakerExecutionRequestV1 {
  return deepFreezeValue(request) as VideoMakerExecutionRequestV1;
}

export function freezeVideoMakerExecutionRequestV1(input: unknown): VideoMakerExecutionRequestV1 {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return freezeAcceptedVideoMakerExecutionRequestV1(VideoMakerExecutionRequestV1Schema.parse(input));
  }
  const candidate = {
    ...(input as Record<string, unknown>),
    requestFingerprint: '0'.repeat(64),
  };
  const normalized = VideoMakerExecutionRequestV1SemanticSchema.parse(candidate);
  return freezeAcceptedVideoMakerExecutionRequestV1(
    VideoMakerExecutionRequestV1Schema.parse({
      ...normalized,
      requestFingerprint: computeVideoMakerRequestFingerprintV1(normalized),
    }),
  );
}

export type VideoMakerExecutionRequestV1 = z.infer<typeof VideoMakerExecutionRequestV1Schema>;
export type ConsumerGptToolParametersV1 = z.infer<typeof ConsumerGptToolParametersV1Schema>;
export type GoogleFlowToolParametersV1 = z.infer<typeof GoogleFlowToolParametersV1Schema>;
export type VideoMakerFrozenInputResourceV1 = z.infer<typeof VideoMakerFrozenInputResourceV1Schema>;
export type VideoMakerOwnerStorageAccessV1 = z.infer<typeof VideoMakerOwnerStorageAccessV1Schema>;
