import { z } from 'zod';
export const SAFE_ERROR_FAMILIES = ['invalid-owner-request','route-not-found','route-deactivated','route-parameter-validation','no-eligible-capacity','login-required','account-attention','adapter-unavailable','provider-rejected','timeout','cancelled','malformed-output','storage-output-failure','callback-failure','reconciliation-required','internal-safe-failure'] as const;
export const SafeErrorV1Schema = z.object({family:z.enum(SAFE_ERROR_FAMILIES),code:z.string().min(1).max(128),message:z.string().min(1).max(1024),retryable:z.boolean(),retryAfterSeconds:z.number().int().positive().optional(),details:z.record(z.string(),z.unknown()).optional(),traceId:z.string().min(1).max(4096)}).strict();
export type SafeErrorV1 = z.infer<typeof SafeErrorV1Schema>;
export class SafeExecutionError extends Error { constructor(public readonly safe: SafeErrorV1){super(safe.message);this.name='SafeExecutionError';} }
