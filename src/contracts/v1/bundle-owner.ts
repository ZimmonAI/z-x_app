import { z } from 'zod';

export const BUNDLE_OWNER_CONTRACT_VERSION = 'zx.bundle-owner.v1' as const;

const safeString = z.string().min(1).max(4096);
const safeKey = z.string().min(1).max(200).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/);
const checksumSha256 = z.string().regex(/^[a-f0-9]{64}$/);
const safeMimeType = z.string().regex(/^[a-z][a-z0-9.+-]*\/[a-z0-9][a-z0-9.+-]*$/);

export const BundleInputItemV1Schema = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('value'),
      value: z.union([z.string().max(65536), z.number().finite(), z.boolean(), z.null(), z.record(z.string(), z.unknown()), z.array(z.unknown())]),
    })
    .strict(),
  z
    .object({
      kind: z.literal('artifact'),
      artifactRef: safeKey.max(512),
      mimeType: safeMimeType.optional(),
      sizeBytes: z.number().int().nonnegative().safe().optional(),
      checksumSha256: checksumSha256.optional(),
    })
    .strict(),
]);

export const BundleOwnerSubmitV1Schema = z
  .object({
    contractVersion: z.literal(BUNDLE_OWNER_CONTRACT_VERSION),
    ownerType: z.literal('app'),
    ownerRef: safeString.max(512),
    bundleVersionId: safeKey.max(512),
    idempotencyKey: safeString.max(512),
    requestFingerprint: checksumSha256,
    inputs: z.record(safeKey, z.array(BundleInputItemV1Schema).max(64)).default({}),
    correlation: z.record(safeKey, safeString).default({}),
  })
  .strict();

export type BundleOwnerSubmitV1 = z.infer<typeof BundleOwnerSubmitV1Schema>;
export type BundleInputItemV1 = z.infer<typeof BundleInputItemV1Schema>;

export const OWNER_EXECUTION_STATES = [
  'accepted',
  'queued',
  'running',
  'succeeded',
  'failed',
  'cancelled',
  'timed-out',
] as const;
export type OwnerExecutionState = (typeof OWNER_EXECUTION_STATES)[number];

export const TemporaryArtifactReferenceV1Schema = z
  .object({
    artifactId: safeKey.max(512),
    mimeType: safeMimeType,
    sizeBytes: z.number().int().nonnegative().safe(),
    checksumSha256: checksumSha256.optional(),
    expiresAt: z.string().datetime(),
    retrievalPath: z.string().regex(/^\/v1\/bundle-executions\/[A-Za-z0-9._:-]+\/artifacts\/[A-Za-z0-9._:-]+$/),
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
    executionId: safeKey.max(512),
    state: z.enum(OWNER_EXECUTION_STATES),
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
    artifactId: safeKey.max(512),
    mimeType: safeMimeType,
    sizeBytes: z.number().int().nonnegative().safe(),
    checksumSha256: checksumSha256.optional(),
    expiresAt: z.string().datetime(),
  })
  .strict();

export type ArtifactMetadataV1 = z.infer<typeof ArtifactMetadataV1Schema>;
