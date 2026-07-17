import { z } from 'zod';
export const SAFE_ERROR_FAMILIES = ['invalid-owner-request', 'route-not-found', 'route-deactivated', 'route-parameter-validation', 'no-eligible-capacity', 'login-required', 'account-attention', 'adapter-unavailable', 'provider-rejected', 'timeout', 'cancelled', 'malformed-output', 'storage-output-failure', 'callback-failure', 'reconciliation-required', 'internal-safe-failure'];
export const SafeErrorV1Schema = z.object({ family: z.enum(SAFE_ERROR_FAMILIES), code: z.string().min(1).max(128), message: z.string().min(1).max(1024), retryable: z.boolean(), retryAfterSeconds: z.number().int().positive().optional(), details: z.record(z.string(), z.unknown()).optional(), traceId: z.string().min(1).max(4096) }).strict();
export class SafeExecutionError extends Error {
    safe;
    constructor(safe) {
        super(safe.message);
        this.safe = safe;
        this.name = 'SafeExecutionError';
    }
}
//# sourceMappingURL=error.js.map