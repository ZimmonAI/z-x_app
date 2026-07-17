import type { FastifyInstance } from 'fastify';
export declare function readinessRoutes(app: FastifyInstance, opts: {
    ready: () => Promise<boolean>;
}): Promise<void>;
