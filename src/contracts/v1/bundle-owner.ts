import { z } from 'zod';

export const BUNDLE_OWNER_CONTRACT_VERSION = 'zx.bundle-owner.v1' as const;
export const MAX_TEMP_ARTIFACT_BYTES = 512 * 1024 * 1024;

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
const safeMimeType = z.string().regex(/^[a-z][a-z0-9.+-]*\/[a-z0-9][a-z0-9.+-]*$/);
const opaqueOwnerReference = safeString
  .max(512)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,511}$/);

export const BundleManifestInputItemV1Schema = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('value'),
      value: z.union([
        z.string().max(65536),
        z.number().finite(),
        z.boolean(),
        z.null(),
        z.record(z.string(), z.unknown()),
        z.array(z.unknown()),
      ]),
    })
    .strict(),
  z
    .object({
      kind: z.literal('artifact'),
      artifactRef: opaqueOwnerReference,
      capabilityRef: opaqueOwnerReference.optional(),
      mimeType: safeMimeType.optional(),
      sizeBytes: z.number().int().nonnegative().safe().max(MAX_TEMP_ARTIFACT_BYTES).optional(),
      checksumSha256: checksumSha256.optional(),
    })
    .strict(),
]);

export const BundleOwnerSubmitV1Schema = z
  .object({
    contractVersion: z.literal(BUNDLE_OWNER_CONTRACT_VERSION),
    ownerApp: safeString.max(200),
    ownerActionId: safeString.max(512),
    ownerProjectId: safeString.max(512).optional(),
    idempotencyKey: safeString.max(512),
    requestFingerprint: checksumSha256,
    bundleVersionId: safeKey,
    manifestInputs: z.record(safeKey, z.array(BundleManifestInputItemV1Schema).max(64)).default({}),
    correlation: z.record(safeKey, safeString.max(1024)).default({}),
    traceId: safeString.max(512).optional(),
  })
  .strict();

export type BundleOwnerSubmitV1 = z.infer<typeof BundleOwnerSubmitV1Schema>;
export type BundleManifestInputItemV1 = z.infer<typeof BundleManifestInputItemV1Schema>;

export const OWNER_EXECUTION_STATUSES = [
  'accepted',
  'queued',
  'running',
  'succeeded',
  'failed',
  'cancelled',
  'timed-out',
] as const;
export type OwnerExecutionStatus = (typeof OWNER_EXECUTION_STATUSES)[number];

export const TemporaryArtifactReferenceV1Schema = z
  .object({
    artifactId: safeKey,
    mimeType: safeMimeType,
    sizeBytes: z.number().int().nonnegative().safe().max(MAX_TEMP_ARTIFACT_BYTES),
    checksumSha256: checksumSha256.optional(),
    expiresAt: z.string().datetime(),
    retrievalPath: z
      .string()
      .regex(
        /^\/internal\/v1\/executions\/[A-Za-z0-9._:-]+\/artifacts\/[A-Za-z0-9._:-]+$/,
      ),
  })
  .strict();

export const BundleOutputItemV1Schema = z
  .object({
    usageKey: safeKey,
    ordinal: z.number().int().min(0),
    value: z.unknown().optional(),
    artifact: TemporaryArtifactReferenceV1Schema.optional(),
  })
  .strict()
  .refine((item) => (item.value === undefined) !== (item.artifact === undefined), {
    message: 'output item must contain exactly one of value or artifact',
  });

export const OwnerTerminalFailureV1Schema = z
  .object({
    code: safeKey,
    message: safeString.max(1024),
  })
  .strict();

export const BundleOwnerExecutionV1Schema = z
  .object({
    contractVersion: z.literal(BUNDLE_OWNER_CONTRACT_VERSION),
    executionId: safeKey,
    status: z.enum(OWNER_EXECUTION_STATUSES),
    outputs: z.array(BundleOutputItemV1Schema),
    failure: OwnerTerminalFailureV1Schema.optional(),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
    terminalAt: z.string().datetime().optional(),
  })
  .strict();

export type BundleOwnerExecutionV1 = z.infer<typeof BundleOwnerExecutionV1Schema>;

export const ArtifactMetadataV1Schema = z
  .object({
    artifactId: safeKey,
    mimeType: safeMimeType,
    sizeBytes: z.number().int().nonnegative().safe().max(MAX_TEMP_ARTIFACT_BYTES),
    checksumSha256: checksumSha256.optional(),
    expiresAt: z.string().datetime(),
  })
  .strict();

export type ArtifactMetadataV1 = z.infer<typeof ArtifactMetadataV1Schema>;
