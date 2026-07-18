import { z } from 'zod';
export declare const CONTRACT_VERSION: "zx.execution.v1";
export declare const FIXTURE_VERSION: "fixture-v1";
export declare const OPERATION_TYPES: readonly ["image_prompt.prepare.v1", "image.generate.v1", "scene_video_prompt.prepare.v1", "scene_video.generate.v1"];
export type OperationType = (typeof OPERATION_TYPES)[number];
export declare const StorageOutputRequestV1Schema: z.ZodObject<{
    contractVersion: z.ZodLiteral<"zx.storage-output.v1">;
    mode: z.ZodEnum<{
        "post-run-ingest": "post-run-ingest";
        "direct-write": "direct-write";
    }>;
    artifactKind: z.ZodEnum<{
        image: "image";
        video: "video";
    }>;
    acceptedMimeTypes: z.ZodArray<z.ZodString>;
    storageProfileRef: z.ZodOptional<z.ZodString>;
    maxBytes: z.ZodOptional<z.ZodNumber>;
}, z.core.$strict>;
export declare const ResourceReferenceV1Schema: z.ZodObject<{
    resourceId: z.ZodString;
    resourceVersionId: z.ZodOptional<z.ZodString>;
    kind: z.ZodString;
    readGrantRef: z.ZodOptional<z.ZodString>;
    checksumSha256: z.ZodOptional<z.ZodString>;
}, z.core.$strict>;
export declare const RouteLocksV1Schema: z.ZodObject<{
    provider: z.ZodDefault<z.ZodString>;
    model: z.ZodDefault<z.ZodString>;
    tool: z.ZodDefault<z.ZodString>;
    software: z.ZodDefault<z.ZodString>;
    runMode: z.ZodDefault<z.ZodString>;
}, z.core.$strict>;
export declare const ExecutionRequestV1Schema: z.ZodObject<{
    contractVersion: z.ZodLiteral<"zx.execution.v1">;
    ownerApp: z.ZodString;
    ownerActionId: z.ZodString;
    ownerProjectId: z.ZodOptional<z.ZodString>;
    idempotencyKey: z.ZodString;
    requestFingerprint: z.ZodString;
    operationType: z.ZodEnum<{
        "image_prompt.prepare.v1": "image_prompt.prepare.v1";
        "image.generate.v1": "image.generate.v1";
        "scene_video_prompt.prepare.v1": "scene_video_prompt.prepare.v1";
        "scene_video.generate.v1": "scene_video.generate.v1";
    }>;
    frozenInputResources: z.ZodArray<z.ZodObject<{
        resourceId: z.ZodString;
        resourceVersionId: z.ZodOptional<z.ZodString>;
        kind: z.ZodString;
        readGrantRef: z.ZodOptional<z.ZodString>;
        checksumSha256: z.ZodOptional<z.ZodString>;
    }, z.core.$strict>>;
    safeScalarInputs: z.ZodRecord<z.ZodString, z.ZodUnknown>;
    routeLocks: z.ZodObject<{
        provider: z.ZodDefault<z.ZodString>;
        model: z.ZodDefault<z.ZodString>;
        tool: z.ZodDefault<z.ZodString>;
        software: z.ZodDefault<z.ZodString>;
        runMode: z.ZodDefault<z.ZodString>;
    }, z.core.$strict>;
    requestedOutputType: z.ZodString;
    storageOutput: z.ZodOptional<z.ZodObject<{
        contractVersion: z.ZodLiteral<"zx.storage-output.v1">;
        mode: z.ZodEnum<{
            "post-run-ingest": "post-run-ingest";
            "direct-write": "direct-write";
        }>;
        artifactKind: z.ZodEnum<{
            image: "image";
            video: "video";
        }>;
        acceptedMimeTypes: z.ZodArray<z.ZodString>;
        storageProfileRef: z.ZodOptional<z.ZodString>;
        maxBytes: z.ZodOptional<z.ZodNumber>;
    }, z.core.$strict>>;
    validationExpectations: z.ZodDefault<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
    timeoutPolicy: z.ZodDefault<z.ZodObject<{
        timeoutSeconds: z.ZodDefault<z.ZodNumber>;
    }, z.core.$strict>>;
    retryPolicy: z.ZodDefault<z.ZodObject<{
        maxAttempts: z.ZodDefault<z.ZodNumber>;
    }, z.core.$strict>>;
    priority: z.ZodDefault<z.ZodNumber>;
    correlation: z.ZodDefault<z.ZodRecord<z.ZodString, z.ZodString>>;
    traceId: z.ZodString;
}, z.core.$strict>;
export type ExecutionRequestV1 = z.infer<typeof ExecutionRequestV1Schema>;
export type StorageOutputRequestV1 = z.infer<typeof StorageOutputRequestV1Schema>;
