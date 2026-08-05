import { z } from 'zod';
import { ProvenanceV1Schema } from './provenance.js';

const technicalMetadata = {
  checksumSha256: z.string().regex(/^[a-f0-9]{64}$/),
  mimeType: z.string().min(1),
  sizeBytes: z.number().int().positive(),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
  durationSeconds: z.number().positive().optional(),
} as const;

/** Corrected owner-facing result: owner correlation plus Z-s technical identity only. */
export const OwnerCorrelatedStorageOutputV1Schema = z
  .object({
    pendingResourceId: z.string().min(1),
    storageObjectId: z.string().min(1),
    // Keep the legacy-only key visible to TypeScript union narrowing without
    // accepting it in the strict owner-correlated runtime contract.
    storageIdentity: z.never().optional(),
    ...technicalMetadata,
  })
  .strict();

/**
 * Explicit fixture-only compatibility for the pre-owner-contract result shape.
 * Real owner-led execution cannot reach this branch because it fails closed at
 * the delegated transport boundary until the owner-published Z-s contract exists.
 */
export const LegacyFixtureOutputResourceV1Schema = z
  .object({
    resourceId: z.string().min(1),
    resourceVersionId: z.string().min(1).optional(),
    storageIdentity: z.string().min(1),
    ...technicalMetadata,
  })
  .strict();

export const OutputResourceV1Schema = z.union([
  OwnerCorrelatedStorageOutputV1Schema,
  LegacyFixtureOutputResourceV1Schema,
]);

export const ExecutionResultV1Schema = z
  .object({
    contractVersion: z.literal('zx.execution.v1'),
    executionId: z.string().uuid(),
    attemptId: z.string().uuid(),
    routeId: z.string(),
    routeVersion: z.string(),
    runtimeBindingRef: z.string(),
    adapterId: z.string(),
    adapterVersion: z.string(),
    outputs: z.array(OutputResourceV1Schema).max(8),
    boundedPromptText: z.string().max(32768).optional(),
    provenance: ProvenanceV1Schema,
    completedAt: z.string().datetime(),
  })
  .strict();

export type OwnerCorrelatedStorageOutputV1 = z.infer<typeof OwnerCorrelatedStorageOutputV1Schema>;
export type ExecutionResultV1 = z.infer<typeof ExecutionResultV1Schema>;
