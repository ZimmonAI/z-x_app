import { z } from 'zod';
export declare const ProvenanceV1Schema: z.ZodObject<{
    routeId: z.ZodString;
    routeVersion: z.ZodString;
    adapterId: z.ZodString;
    adapterVersion: z.ZodString;
    runtimeBindingRef: z.ZodString;
    fixtureVersion: z.ZodOptional<z.ZodLiteral<"fixture-v1">>;
    startedAt: z.ZodString;
    completedAt: z.ZodString;
}, z.core.$strict>;
export type ProvenanceV1 = z.infer<typeof ProvenanceV1Schema>;
