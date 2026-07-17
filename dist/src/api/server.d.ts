import Fastify from 'fastify';
import type { Config } from '../config.js';
import { type AuthVerifier } from './auth.js';
import { type ExecutionService } from './routes/executions.js';
export declare function buildServer(options: {
    config: Config;
    verify?: AuthVerifier;
    service?: ExecutionService;
    ready?: () => Promise<boolean>;
}): Promise<Fastify.FastifyInstance<import("node:http").Server<typeof import("node:http").IncomingMessage, typeof import("node:http").ServerResponse>, import("node:http").IncomingMessage, import("node:http").ServerResponse<import("node:http").IncomingMessage>, Fastify.FastifyBaseLogger, Fastify.FastifyTypeProviderDefault>>;
