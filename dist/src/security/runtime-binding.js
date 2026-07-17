import { z } from 'zod';
export const RuntimeBindingRefSchema = z.string().regex(/^rb_[a-zA-Z0-9_-]{8,128}$/);
export function assertProtectedRuntimeBinding(ref) { return RuntimeBindingRefSchema.parse(ref); }
export function resolveRuntimeBinding() { throw new Error('real runtime binding resolution is disabled until an owner-published contract is enabled'); }
//# sourceMappingURL=runtime-binding.js.map