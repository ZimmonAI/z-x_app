import { createHash } from 'node:crypto';
import { z } from 'zod';

export const BUNDLE_OWNER_EXECUTION_CONTRACT_VERSION = 'zx.bundle-owner.execution.v1' as const;

const MAX_STRING_LENGTH = 4096;
const MAX_JSON_DEPTH = 8;
const MAX_COLLECTION_ITEMS = 64;

function hasNoForbiddenControlCharacters(value: string): boolean {
  return Array.from(value).every((character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint >= 32 || codePoint === 9 || codePoint === 10 || codePoint === 13;
  });
}

function isSafeJsonValue(value: unknown, depth = 0): boolean {
  if (depth > MAX_JSON_DEPTH) return false;
  if (value === null || typeof value === 'boolean') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (typeof value === 'string') {
    return value.length <= MAX_STRING_LENGTH && hasNoForbiddenControlCharacters(value);
  }
  if (Array.isArray(value)) {
    return (
      value.length <= MAX_COLLECTION_ITEMS &&
      value.every((item) => isSafeJsonValue(item, depth + 1))
    );
  }
  if (typeof value === 'object') {
    const entries = Object.entries(value);
    return (
      entries.length <= MAX_COLLECTION_ITEMS &&
      entries.every(
        ([key, item]) =>
          key.length > 0 &&
          key.length <= 256 &&
          hasNoForbiddenControlCharacters(key) &&
          isSafeJsonValue(item, depth + 1),
      )
    );
  }
  return false;
}

function stableJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => stableJson(item)).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>).sort(([left], [right]) =>
    left.localeCompare(right),
  );
  return `{${entries
    .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`)
    .join(',')}}`;
}

const safeString = z
  .string()
  .min(1)
  .max(MAX_STRING_LENGTH)
  .refine(hasNoForbiddenControlCharacters, 'control characters prohibited');

const opaqueReference = safeString
  .max(512)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,511}$/)
  .refine((value) => !value.includes('/') && !value.includes('\\') && !value.includes('@'), {
    message: 'reference must be opaque',
  });

const safeMimeType = safeString.regex(/^[a-z][a-z0-9.+-]*\/[a-z0-9][a-z0-9.+-]*$/);
const checksumSha256 = z.string().regex(/^[a-f0-9]{64}$/);
const safeJsonValue = z.unknown().refine((value) => isSafeJsonValue(value), 'unsafe JSON value');
const safeFileNameHint = safeString
  .max(255)
  .refine(
    (value) => !value.includes('/') && !value.includes('\\') && value !== '.' && value !== '..',
    'file name hint must not contain a path',
  );

export const BundleInputItemV1Schema = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('value'),
      value: safeJsonValue,
    })
    .strict(),
  z
    .object({
      kind: z.literal('resource'),
      resourceRef: opaqueReference,
      mimeType: safeMimeType.optional(),
      sizeBytes: z.number().int().nonnegative().safe().optional(),
      checksumSha256: checksumSha256.optional(),
    })
    .strict(),
]);

const inputMap = z
  .record(z.string().min(1).max(256), z.array(BundleInputItemV1Schema).max(32))
  .superRefine((inputs, context) => {
    if (Object.keys(inputs).length > MAX_COLLECTION_ITEMS) {
      context.addIssue({ code: 'custom', message: 'too many manifest input keys' });
    }
  });

export const BundleExecutionFingerprintMaterialV1Schema = z
  .object({
    ownerType: z.literal('app'),
    ownerRef: opaqueReference,
    bundleVersionId: opaqueReference,
    inputs: inputMap,
    correlation: z.record(z.string().min(1).max(128), safeString.max(512)).default({}),
  })
  .strict();

export const BundleExecutionRequestV1Schema = BundleExecutionFingerprintMaterialV1Schema.extend({
  idempotencyKey: opaqueReference,
  requestFingerprint: checksumSha256,
}).strict();

export const TemporaryArtifactDescriptorV1Schema = z
  .object({
    artifactRef: opaqueReference,
    mimeType: safeMimeType,
    sizeBytes: z.number().int().nonnegative().safe(),
    checksumSha256: checksumSha256.optional(),
    fileNameHint: safeFileNameHint.optional(),
    expiresAt: z.iso.datetime(),
  })
  .strict();

export const FinalOutputItemV1Schema = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('value'),
      value: safeJsonValue,
    })
    .strict(),
  z
    .object({
      kind: z.literal('temporary-artifact'),
      artifact: TemporaryArtifactDescriptorV1Schema,
    })
    .strict(),
]);

export const FinalOutputV1Schema = z
  .object({
    manifestKey: safeString.max(256),
    usageKey: safeString.max(256),
    items: z.array(FinalOutputItemV1Schema).max(32),
  })
  .strict();

export const SafeTerminalFailureV1Schema = z
  .object({
    code: safeString.max(128),
    message: safeString.max(1024),
  })
  .strict();

export const BundleExecutionStateV1Schema = z.enum([
  'accepted',
  'queued',
  'running',
  'succeeded',
  'failed',
  'cancelled',
]);

export const BundleExecutionViewV1Schema = z
  .object({
    contractVersion: z.literal(BUNDLE_OWNER_EXECUTION_CONTRACT_VERSION),
    executionId: opaqueReference,
    bundleVersionId: opaqueReference,
    ownerRef: opaqueReference,
    state: BundleExecutionStateV1Schema,
    outputs: z.array(FinalOutputV1Schema),
    failure: SafeTerminalFailureV1Schema.optional(),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
    terminalAt: z.iso.datetime().optional(),
  })
  .strict();

export type BundleInputItemV1 = z.infer<typeof BundleInputItemV1Schema>;
export type BundleExecutionFingerprintMaterialV1 = z.infer<
  typeof BundleExecutionFingerprintMaterialV1Schema
>;
export type BundleExecutionRequestV1 = z.infer<typeof BundleExecutionRequestV1Schema>;
export type TemporaryArtifactDescriptorV1 = z.infer<typeof TemporaryArtifactDescriptorV1Schema>;
export type FinalOutputItemV1 = z.infer<typeof FinalOutputItemV1Schema>;
export type FinalOutputV1 = z.infer<typeof FinalOutputV1Schema>;
export type BundleExecutionViewV1 = z.infer<typeof BundleExecutionViewV1Schema>;

export function computeBundleExecutionRequestFingerprint(
  material: BundleExecutionFingerprintMaterialV1,
): string {
  const normalized = BundleExecutionFingerprintMaterialV1Schema.parse(material);
  return createHash('sha256').update(stableJson(normalized), 'utf8').digest('hex');
}
