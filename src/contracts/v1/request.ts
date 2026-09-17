import { z } from 'zod';

export const CONTRACT_VERSION = 'zx.execution.v1' as const;

function hasNoForbiddenControlCharacters(value: string): boolean {
  return Array.from(value).every((character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint >= 32 || codePoint === 9 || codePoint === 10 || codePoint === 13;
  });
}

export const safeString = z
  .string()
  .min(1)
  .max(4096)
  .refine(hasNoForbiddenControlCharacters, 'control characters prohibited');

export const RequestV1Schema = z
  .object({
    contractVersion: z.literal(CONTRACT_VERSION),
    clientRequestRef: safeString.max(512).optional(),
    idempotencyKey: safeString.max(512),
    requestFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
    bundleVersionId: z.string().uuid(),
    storageConnectionId: z.string().uuid().optional(),
    requestedOutputCount: z.number().int().min(1).max(256),
    inputPayload: z.record(z.string(), z.unknown()),
    traceId: safeString.max(512).optional(),
  })
  .strict();

export type RequestV1 = z.infer<typeof RequestV1Schema>;

export const RequestStateSchema = z.enum([
  'accepted',
  'planned',
  'queued',
  'running',
  'succeeded',
  'failed',
  'cancelled',
  'reconciliation-required',
]);
export type RequestState = z.infer<typeof RequestStateSchema>;

const RegisteredObjectResultSchema = z
  .object({
    zxObjectId: z.string().uuid(),
    externalObjectId: safeString.max(4096),
  })
  .strict();

const TemporaryObjectResultSchema = z
  .object({
    zxObjectId: z.string().uuid(),
    zxTemporaryArtifactId: z.string().uuid(),
  })
  .strict();

export const RequestObjectResultSchema = z.union([
  RegisteredObjectResultSchema,
  TemporaryObjectResultSchema,
]);
export type RequestObjectResult = z.infer<typeof RequestObjectResultSchema>;

export const RequestResultV1Schema = z
  .object({
    contractVersion: z.literal(CONTRACT_VERSION),
    zxRequestId: z.string().uuid(),
    clientRequestRef: safeString.max(512).optional(),
    state: RequestStateSchema,
    requestedOutputCount: z.number().int().positive(),
    completedOutputCount: z.number().int().nonnegative(),
    outputs: z.array(RequestObjectResultSchema),
    error: z
      .object({
        code: safeString.max(200),
        message: safeString.max(4096),
      })
      .strict()
      .optional(),
  })
  .strict();

export type RequestResultV1 = z.infer<typeof RequestResultV1Schema>;
