import { z } from 'zod';
export const ProvenanceV1Schema = z.object({ routeId: z.string(), routeVersion: z.string(), adapterId: z.string(), adapterVersion: z.string(), runtimeBindingRef: z.string(), fixtureVersion: z.literal('fixture-v1').optional(), startedAt: z.string().datetime(), completedAt: z.string().datetime() }).strict();
//# sourceMappingURL=provenance.js.map