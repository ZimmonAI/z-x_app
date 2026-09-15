import { z } from 'zod';

export const CONTRACT_VERSION = 'zx.execution.v2' as const;
export const GENERIC_OPERATION_TYPE = 'generic.execute.v2' as const;

function hasNoForbiddenControlCharacters(value: string): boolean {
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
const safeKey = z.string().min(1).max(200).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/);
const checksumSha256 = z.string().regex(/^[a-f0-9]{64}$/);

// Z-s delegated upload capabilities are intentionally opaque to Z-X. The transport
// validates only the bounded signed-capability wire shape; claim semantics remain Z-s-owned.
const delegatedZsCapability = z
  .string()
  .min(32)
  .max(4096)
  .regex(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);

export const DelegatedZsStorageAccessV1Schema = z
  .object({
    service: z.literal('z-s'),
    audience: z.literal('z-x_app'),
    capability: delegatedZsCapability,
  })
  .strict();

export const RuntimeRequirementV1Schema = z
  .object({
    kind: safeKey,
    value: z.json().optional(),
    valueFrom: safeString.max(1024).optional(),
  })
  .strict()
  .superRefine((requirement, context) => {
    if ((requirement.value === undefined) === (requirement.valueFrom === undefined)) {
      context.addIssue({
        code: 'custom',
        message: 'runtime requirement must contain exactly one of value or valueFrom',
      });
    }
  });

export const ExecutionRequestV2Schema = z
  .object({
    contractVersion: z.literal(CONTRACT_VERSION),
    ownerApp: safeString.max(200),
    ownerActionId: safeString.max(512),
    ownerProjectId: safeString.max(512).optional(),
    idempotencyKey: safeString.max(512),
    requestFingerprint: checksumSha256,
    executionMethodRef: safeKey,
    payload: z.json(),
    runtimeRequirements: z.array(RuntimeRequirementV1Schema).max(32).default([]),
    storageAccess: DelegatedZsStorageAccessV1Schema.optional(),
    timeoutPolicy: z
      .object({ timeoutSeconds: z.number().int().min(30).max(3600).default(900) })
      .strict()
      .default({ timeoutSeconds: 900 }),
    retryPolicy: z
      .object({ maxAttempts: z.number().int().min(1).max(5).default(3) })
      .strict()
      .default({ maxAttempts: 3 }),
    priority: z.number().int().min(0).max(9).default(5),
    correlation: z.record(safeKey, safeString.max(1024)).default({}),
    traceId: safeString.max(512),
  })
  .strict();

export const GenericExecutionViewV2Schema = z
  .object({
    contractVersion: z.literal(CONTRACT_VERSION),
    executionId: safeKey,
    status: z.enum([
      'accepted',
      'resolving-route',
      'waiting-capacity',
      'queued',
      'running',
      'succeeded',
      'failed',
      'cancelled',
      'timed-out',
      'reconciliation-required',
    ]),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
    terminalAt: z.string().datetime().optional(),
  })
  .strict();

export type ExecutionRequestV2 = z.infer<typeof ExecutionRequestV2Schema>;
export type DelegatedZsStorageAccessV1 = z.infer<typeof DelegatedZsStorageAccessV1Schema>;
export type RuntimeRequirementV1 = z.infer<typeof RuntimeRequirementV1Schema>;
export type GenericExecutionViewV2 = z.infer<typeof GenericExecutionViewV2Schema>;
