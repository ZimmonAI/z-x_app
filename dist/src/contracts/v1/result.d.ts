import { z } from 'zod';
/** Corrected owner-facing result: owner correlation plus Z-s technical identity only. */
export declare const OwnerCorrelatedStorageOutputV1Schema: z.ZodObject<{
    checksumSha256: z.ZodString;
    mimeType: z.ZodString;
    sizeBytes: z.ZodNumber;
    width: z.ZodOptional<z.ZodNumber>;
    height: z.ZodOptional<z.ZodNumber>;
    durationSeconds: z.ZodOptional<z.ZodNumber>;
    pendingResourceId: z.ZodString;
    storageObjectId: z.ZodString;
    storageIdentity: z.ZodOptional<z.ZodNever>;
}, z.core.$strict>;
/**
 * Explicit fixture-only compatibility for the pre-owner-contract result shape.
 * Real owner-led execution cannot reach this branch because it fails closed at
 * the delegated transport boundary until the owner-published Z-s contract exists.
 */
export declare const LegacyFixtureOutputResourceV1Schema: z.ZodObject<{
    checksumSha256: z.ZodString;
    mimeType: z.ZodString;
    sizeBytes: z.ZodNumber;
    width: z.ZodOptional<z.ZodNumber>;
    height: z.ZodOptional<z.ZodNumber>;
    durationSeconds: z.ZodOptional<z.ZodNumber>;
    resourceId: z.ZodString;
    resourceVersionId: z.ZodOptional<z.ZodString>;
    storageIdentity: z.ZodString;
}, z.core.$strict>;
export declare const OutputResourceV1Schema: z.ZodUnion<readonly [z.ZodObject<{
    checksumSha256: z.ZodString;
    mimeType: z.ZodString;
    sizeBytes: z.ZodNumber;
    width: z.ZodOptional<z.ZodNumber>;
    height: z.ZodOptional<z.ZodNumber>;
    durationSeconds: z.ZodOptional<z.ZodNumber>;
    pendingResourceId: z.ZodString;
    storageObjectId: z.ZodString;
    storageIdentity: z.ZodOptional<z.ZodNever>;
}, z.core.$strict>, z.ZodObject<{
    checksumSha256: z.ZodString;
    mimeType: z.ZodString;
    sizeBytes: z.ZodNumber;
    width: z.ZodOptional<z.ZodNumber>;
    height: z.ZodOptional<z.ZodNumber>;
    durationSeconds: z.ZodOptional<z.ZodNumber>;
    resourceId: z.ZodString;
    resourceVersionId: z.ZodOptional<z.ZodString>;
    storageIdentity: z.ZodString;
}, z.core.$strict>]>;
export declare const ExecutionResultV1Schema: z.ZodObject<{
    contractVersion: z.ZodLiteral<"zx.execution.v1">;
    executionId: z.ZodString;
    attemptId: z.ZodString;
    routeId: z.ZodString;
    routeVersion: z.ZodString;
    runtimeBindingRef: z.ZodString;
    adapterId: z.ZodString;
    adapterVersion: z.ZodString;
    outputs: z.ZodArray<z.ZodUnion<readonly [z.ZodObject<{
        checksumSha256: z.ZodString;
        mimeType: z.ZodString;
        sizeBytes: z.ZodNumber;
        width: z.ZodOptional<z.ZodNumber>;
        height: z.ZodOptional<z.ZodNumber>;
        durationSeconds: z.ZodOptional<z.ZodNumber>;
        pendingResourceId: z.ZodString;
        storageObjectId: z.ZodString;
        storageIdentity: z.ZodOptional<z.ZodNever>;
    }, z.core.$strict>, z.ZodObject<{
        checksumSha256: z.ZodString;
        mimeType: z.ZodString;
        sizeBytes: z.ZodNumber;
        width: z.ZodOptional<z.ZodNumber>;
        height: z.ZodOptional<z.ZodNumber>;
        durationSeconds: z.ZodOptional<z.ZodNumber>;
        resourceId: z.ZodString;
        resourceVersionId: z.ZodOptional<z.ZodString>;
        storageIdentity: z.ZodString;
    }, z.core.$strict>]>>;
    boundedPromptText: z.ZodOptional<z.ZodString>;
    provenance: z.ZodObject<{
        routeId: z.ZodString;
        routeVersion: z.ZodString;
        adapterId: z.ZodString;
        adapterVersion: z.ZodString;
        runtimeBindingRef: z.ZodString;
        fixtureVersion: z.ZodOptional<z.ZodLiteral<"fixture-v1">>;
        startedAt: z.ZodString;
        completedAt: z.ZodString;
    }, z.core.$strict>;
    completedAt: z.ZodString;
}, z.core.$strict>;
export type OwnerCorrelatedStorageOutputV1 = z.infer<typeof OwnerCorrelatedStorageOutputV1Schema>;
export type ExecutionResultV1 = z.infer<typeof ExecutionResultV1Schema>;
