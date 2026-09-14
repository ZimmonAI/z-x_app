import { z } from 'zod';

export const BUNDLE_EXECUTION_CONTRACT_VERSION = 'zx.execution.bundle.v1' as const;

const safeString = z.string().min(1).max(4096);
const sha256 = z.string().regex(/^[a-f0-9]{64}$/);
const timestamp = z.string().datetime();

export const BundleExecutionStateSchema = z.enum([
  'accepted',
  'queued',
  'running',
  'succeeded',
  'failed',
  'cancelled',
  'timed-out',
]);

export const BundleExecutionSubmitRequestSchema = z
  .object({
    contractVersion: z.literal(BUNDLE_EXECUTION_CONTRACT_VERSION),
    ownerType: z.literal('app'),
    ownerRef: safeString,
    bundleVersionId: safeString,
    idempotencyKey: safeString,
    requestFingerprint: sha256,
    inputs: z.record(safeString, z.array(z.unknown()).max(128)),
    correlation: z.record(safeString, safeString).default({}),
  })
  .strict();

export const BundleArtifactReferenceSchema = z
  .object({
    artifactId: safeString,
    mimeType: safeString,
    sizeBytes: z.number().int().nonnegative().safe().optional(),
    checksumSha256: sha256.optional(),
    expiresAt: timestamp,
  })
  .strict();

export const BundleOutputItemSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('value'), value: z.unknown() }).strict(),
  z.object({ kind: z.literal('artifact'), artifact: BundleArtifactReferenceSchema }).strict(),
]);

export const BundleExecutionOutputSchema = z
  .object({
    usageKey: safeString,
    items: z.array(BundleOutputItemSchema).max(128),
  })
  .strict();

export const BundleExecutionFailureSchema = z
  .object({
    code: safeString,
    message: safeString,
    retryable: z.boolean().optional(),
  })
  .strict();

export const BundleExecutionViewSchema = z
  .object({
    contractVersion: z.literal(BUNDLE_EXECUTION_CONTRACT_VERSION),
    executionId: safeString,
    ownerRef: safeString,
    bundleVersionId: safeString,
    state: BundleExecutionStateSchema,
    outputs: z.array(BundleExecutionOutputSchema).default([]),
    failure: BundleExecutionFailureSchema.optional(),
    createdAt: timestamp,
    updatedAt: timestamp,
    terminalAt: timestamp.optional(),
  })
  .strict();

export const BundleExecutionCancelResponseSchema = z
  .object({
    execution: BundleExecutionViewSchema,
    cancellationAccepted: z.boolean(),
  })
  .strict();

export interface BundleArtifactDownload {
  bytes: Uint8Array;
  mimeType: string;
  sizeBytes?: number;
  checksumSha256?: string;
  expiresAt: string;
}

export type BundleExecutionSubmitRequest = z.infer<typeof BundleExecutionSubmitRequestSchema>;
export type BundleExecutionView = z.infer<typeof BundleExecutionViewSchema>;
export type BundleExecutionCancelResponse = z.infer<typeof BundleExecutionCancelResponseSchema>;
