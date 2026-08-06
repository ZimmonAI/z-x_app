import { z } from 'zod';
export const CONTRACT_VERSION = 'zx.execution.v1';
export const FIXTURE_VERSION = 'fixture-v1';
export const OWNER_STORAGE_ACCESS_VERSION = 'zx.owner-storage-access.v1';
export const OPERATION_TYPES = [
    'image_prompt.prepare.v1',
    'image.generate.v1',
    'scene_video_prompt.prepare.v1',
    'scene_video.generate.v1',
];
const STORAGE_OUTPUT_VERSION = 'zx.storage-output.v1';
function hasNoForbiddenControlCharacters(value) {
    return Array.from(value).every((character) => {
        const codePoint = character.codePointAt(0) ?? 0;
        return codePoint >= 32 || codePoint === 9 || codePoint === 10 || codePoint === 13;
    });
}
const safeString = z
    .string()
    .min(1)
    .max(4096)
    .refine(hasNoForbiddenControlCharacters, 'control characters prohibited');
const safeMimeType = safeString.regex(/^[a-z][a-z0-9.+-]*\/[a-z0-9][a-z0-9.+-]*$/);
function hasUniqueValues(values) {
    return new Set(values).size === values.length;
}
function isSafeStorageProfileRef(value) {
    return /^zs-profile:[A-Za-z0-9._:-]{1,200}$/.test(value);
}
const forbiddenCapabilityFragments = [
    'http:',
    'https:',
    'file:',
    's3:',
    'r2:',
    'minio',
    'bucket',
    'prefix',
    'objectkey',
    'object-key',
    'accesskey',
    'secretkey',
    'credential',
    'bearer ',
    'token=',
    'signedurl',
];
export function isOpaqueOwnerCapabilityReference(value) {
    if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,511}$/.test(value))
        return false;
    if (value.includes('/') || value.includes('\\') || value.includes('@'))
        return false;
    const normalized = value.toLowerCase();
    return !forbiddenCapabilityFragments.some((fragment) => normalized.includes(fragment));
}
const opaqueCapabilityReference = safeString
    .max(512)
    .refine(isOpaqueOwnerCapabilityReference, 'owner capability reference must be opaque');
export const StorageOutputRequestV1Schema = z
    .object({
    contractVersion: z.literal(STORAGE_OUTPUT_VERSION),
    mode: z.enum(['post-run-ingest', 'direct-write']),
    artifactKind: z.enum(['image', 'video']),
    acceptedMimeTypes: z.array(safeMimeType).min(1).max(16).refine(hasUniqueValues, {
        message: 'acceptedMimeTypes must be unique',
    }),
    storageProfileRef: safeString
        .refine(isSafeStorageProfileRef, 'unsafe storage profile reference')
        .optional(),
    maxBytes: z.number().int().positive().safe().optional(),
})
    .strict();
export const OwnerStorageAccessV1Schema = z
    .object({
    contractVersion: z.literal(OWNER_STORAGE_ACCESS_VERSION),
    pendingResourceId: safeString.max(512),
    outputWriteGrantRef: opaqueCapabilityReference,
    artifactKind: z.enum(['image', 'video']),
    acceptedMimeTypes: z.array(safeMimeType).min(1).max(16).refine(hasUniqueValues, {
        message: 'acceptedMimeTypes must be unique',
    }),
    maxBytes: z.number().int().positive().safe().optional(),
})
    .strict();
export const ResourceReferenceV1Schema = z
    .object({
    resourceId: safeString,
    resourceVersionId: safeString.optional(),
    storageObjectId: safeString.max(512).optional(),
    kind: safeString,
    role: safeString.optional(),
    readGrantRef: opaqueCapabilityReference.optional(),
    checksumSha256: z.string().regex(/^[a-f0-9]{64}$/).optional(),
})
    .strict();
export const RouteLocksV1Schema = z
    .object({
    provider: safeString.default('AUTO'),
    model: safeString.default('AUTO'),
    tool: safeString.default('AUTO'),
    software: safeString.default('AUTO'),
    runMode: safeString.default('AUTO'),
})
    .strict();
function isGeneratedMediaOperation(operationType) {
    return operationType === 'image.generate.v1' || operationType === 'scene_video.generate.v1';
}
function validateOutputShape(request, output, path, context) {
    if (!output.acceptedMimeTypes.includes(request.requestedOutputType)) {
        context.addIssue({
            code: 'custom',
            path: [path, 'acceptedMimeTypes'],
            message: 'requestedOutputType must be accepted',
        });
    }
    if (request.operationType === 'image.generate.v1') {
        if (output.artifactKind !== 'image') {
            context.addIssue({
                code: 'custom',
                path: [path, 'artifactKind'],
                message: 'image operation requires image artifact kind',
            });
        }
        if (!request.requestedOutputType.startsWith('image/')) {
            context.addIssue({
                code: 'custom',
                path: ['requestedOutputType'],
                message: 'image operation requires image output MIME',
            });
        }
    }
    if (request.operationType === 'scene_video.generate.v1') {
        if (output.artifactKind !== 'video') {
            context.addIssue({
                code: 'custom',
                path: [path, 'artifactKind'],
                message: 'scene-video operation requires video artifact kind',
            });
        }
        if (!request.requestedOutputType.startsWith('video/')) {
            context.addIssue({
                code: 'custom',
                path: ['requestedOutputType'],
                message: 'scene-video operation requires video output MIME',
            });
        }
    }
}
export const ExecutionRequestV1Schema = z
    .object({
    contractVersion: z.literal(CONTRACT_VERSION),
    ownerApp: safeString,
    ownerActionId: safeString,
    ownerProjectId: safeString.optional(),
    idempotencyKey: safeString,
    requestFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
    operationType: z.enum(OPERATION_TYPES),
    frozenInputResources: z.array(ResourceReferenceV1Schema).max(32),
    safeScalarInputs: z.record(z.string(), z.unknown()),
    routeLocks: RouteLocksV1Schema,
    requestedOutputType: safeMimeType,
    ownerStorageAccess: OwnerStorageAccessV1Schema.optional(),
    storageOutput: StorageOutputRequestV1Schema.optional(),
    validationExpectations: z.record(z.string(), z.unknown()).default({}),
    timeoutPolicy: z
        .object({ timeoutSeconds: z.number().int().min(30).max(3600).default(900) })
        .strict()
        .default({ timeoutSeconds: 900 }),
    retryPolicy: z
        .object({ maxAttempts: z.number().int().min(1).max(5).default(3) })
        .strict()
        .default({ maxAttempts: 3 }),
    priority: z.number().int().min(0).max(9).default(5),
    correlation: z.record(z.string(), safeString).default({}),
    traceId: safeString,
})
    .strict()
    .superRefine((request, context) => {
    const generatedMedia = isGeneratedMediaOperation(request.operationType);
    const fixtureMode = typeof request.safeScalarInputs.fixtureScenario === 'string';
    const ownerStorageAccess = request.ownerStorageAccess;
    const storageOutput = request.storageOutput;
    if (generatedMedia && !fixtureMode && !ownerStorageAccess) {
        context.addIssue({
            code: 'custom',
            path: ['ownerStorageAccess'],
            message: 'ZX_OWNER_STORAGE_ACCESS_REQUIRED',
        });
    }
    if (generatedMedia && !fixtureMode) {
        request.frozenInputResources.forEach((resource, index) => {
            if (!resource.storageObjectId) {
                context.addIssue({
                    code: 'custom',
                    path: ['frozenInputResources', index, 'storageObjectId'],
                    message: 'real generated-media input requires storageObjectId',
                });
            }
            if (!resource.readGrantRef) {
                context.addIssue({
                    code: 'custom',
                    path: ['frozenInputResources', index, 'readGrantRef'],
                    message: 'real generated-media input requires readGrantRef',
                });
            }
            if (!resource.role && !resource.kind) {
                context.addIssue({
                    code: 'custom',
                    path: ['frozenInputResources', index, 'role'],
                    message: 'real generated-media input requires an owner-frozen role',
                });
            }
        });
    }
    if (storageOutput) {
        validateOutputShape(request, storageOutput, 'storageOutput', context);
    }
    if (ownerStorageAccess) {
        validateOutputShape(request, ownerStorageAccess, 'ownerStorageAccess', context);
    }
});
//# sourceMappingURL=execution.js.map