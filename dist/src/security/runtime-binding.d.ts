import { z } from 'zod';
export declare const RuntimeBindingRefSchema: z.ZodString;
export declare function assertProtectedRuntimeBinding(ref: string): string;
export declare function resolveRuntimeBinding(): never;
