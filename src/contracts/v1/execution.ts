import { z } from 'zod';

export const CONTRACT_VERSION = 'zx.execution.v1' as const;

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

export const ExecutionRequestV1Schema = z
  .object({
    contractVersion: z.literal(CONTRACT_VERSION),
    ownerApp: safeString.max(200),
    ownerActionId: safeString.max(512),
    ownerProjectId: safeString.max(512).optional(),
    idempotencyKey: safeString.max(512),
    requestFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
    payload: z.record(z.string(), z.unknown()).default({}),
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

export type ExecutionRequestV1 = z.infer<typeof ExecutionRequestV1Schema>;
