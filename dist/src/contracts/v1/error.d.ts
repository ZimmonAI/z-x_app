import { z } from 'zod';
export declare const SAFE_ERROR_FAMILIES: readonly ["invalid-owner-request", "route-not-found", "route-deactivated", "route-parameter-validation", "no-eligible-capacity", "login-required", "account-attention", "adapter-unavailable", "provider-rejected", "timeout", "cancelled", "malformed-output", "storage-output-failure", "callback-failure", "reconciliation-required", "internal-safe-failure"];
export declare const SafeErrorV1Schema: z.ZodObject<{
    family: z.ZodEnum<{
        cancelled: "cancelled";
        "reconciliation-required": "reconciliation-required";
        timeout: "timeout";
        "route-not-found": "route-not-found";
        "route-deactivated": "route-deactivated";
        "login-required": "login-required";
        "account-attention": "account-attention";
        "provider-rejected": "provider-rejected";
        "malformed-output": "malformed-output";
        "callback-failure": "callback-failure";
        "invalid-owner-request": "invalid-owner-request";
        "route-parameter-validation": "route-parameter-validation";
        "no-eligible-capacity": "no-eligible-capacity";
        "adapter-unavailable": "adapter-unavailable";
        "storage-output-failure": "storage-output-failure";
        "internal-safe-failure": "internal-safe-failure";
    }>;
    code: z.ZodString;
    message: z.ZodString;
    retryable: z.ZodBoolean;
    retryAfterSeconds: z.ZodOptional<z.ZodNumber>;
    details: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
    traceId: z.ZodString;
}, z.core.$strict>;
export type SafeErrorV1 = z.infer<typeof SafeErrorV1Schema>;
export declare class SafeExecutionError extends Error {
    readonly safe: SafeErrorV1;
    constructor(safe: SafeErrorV1);
}
