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
const delegatedAuthorityKind = safeKey.refine(
  (kind) => !/(bearer|credential|secret|password)/i.test(kind),
  'credential-like delegated authority labels are prohibited',
);
const checksumSha256 = z.string().regex(/^[a-f0-9]{64}$/);
const opaqueProtectedReference = z
  .string()
  .min(1)
  .max(4096)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:~-]{0,4095}$/);

export const DelegatedZsAuthorityV1Schema = z
  .object({
    kind: delegatedAuthorityKind,
    value: opaqueProtectedReference,
  })
  .strict();

// Z-X deliberately does not decode or reinterpret these Z-s values. `kind` is an
// opaque caller/runtime binding label; Z-s remains authoritative for capability
// validity, producer audience, exact object/service selection, content bounds and expiry.
export const DelegatedZsStorageAccessV1Schema = z
  .object({
    service: z.literal('z-s'),
    authorities: z.array(DelegatedZsAuthorityV1Schema).min(1).max(16),
  })
  .strict()
  .superRefine((access, context) => {
    const kinds = new Set<string>();
    for (const authority of access.authorities) {
      if (kinds.has(authority.kind)) {
        context.addIssue({
          code: 'custom',
          message: `duplicate delegated Z-s authority kind: ${authority.kind}`,
        });
      }
      kinds.add(authority.kind);
    }
  });

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
export type DelegatedZsAuthorityV1 = z.infer<typeof DelegatedZsAuthorityV1Schema>;
export type DelegatedZsStorageAccessV1 = z.infer<typeof DelegatedZsStorageAccessV1Schema>;
export type RuntimeRequirementV1 = z.infer<typeof RuntimeRequirementV1Schema>;
export type GenericExecutionViewV2 = z.infer<typeof GenericExecutionViewV2Schema>;
