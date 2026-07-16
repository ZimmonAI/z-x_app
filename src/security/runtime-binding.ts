import { z } from 'zod';
export const RuntimeBindingRefSchema=z.string().regex(/^rb_[a-zA-Z0-9_-]{8,128}$/);
export function assertProtectedRuntimeBinding(ref:string):string{return RuntimeBindingRefSchema.parse(ref);}
export function resolveRuntimeBinding():never{throw new Error('real runtime binding resolution is disabled until an owner-published contract is enabled');}
