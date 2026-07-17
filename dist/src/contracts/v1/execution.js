import { z } from 'zod';
export const CONTRACT_VERSION = 'zx.execution.v1';
export const FIXTURE_VERSION = 'fixture-v1';
export const OPERATION_TYPES = [
    'image_prompt.prepare.v1',
    'image.generate.v1',
    'scene_video_prompt.prepare.v1',
    'scene_video.generate.v1',
];
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
export const ResourceReferenceV1Schema = z
    .object({
    resourceId: safeString,
    resourceVersionId: safeString.optional(),
    kind: safeString,
    readGrantRef: safeString.optional(),
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
    requestedOutputType: safeString,
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
    .strict();
//# sourceMappingURL=execution.js.map