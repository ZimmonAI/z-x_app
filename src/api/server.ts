import Fastify from 'fastify';
import type { Config } from '../config.js';
import { createLogger } from '../observability/logger.js';
import { createAuthVerifier, type AuthVerifier } from './auth.js';
import {
  executionRoutes,
  MemoryExecutionService,
  type ExecutionService,
} from './routes/executions.js';
import { healthRoutes } from './routes/health.js';
import { readinessRoutes } from './routes/readiness.js';

export async function buildServer(options: {
  config: Config;
  verify?: AuthVerifier;
  service?: ExecutionService;
  ready?: () => Promise<boolean>;
}) {
  const app = Fastify({
    loggerInstance: createLogger(options.config.ZX_LOG_LEVEL),
    bodyLimit: 256 * 1024,
  });
  app.setErrorHandler((error, _request, reply) => {
    const statusCode = (error as { statusCode?: number }).statusCode ?? 400;
    const message = error instanceof Error ? error.message : 'request failed';
    void reply.code(statusCode).send({ error: message });
  });
  await healthRoutes(app);
  await readinessRoutes(app, { ready: options.ready ?? (async () => true) });
  await executionRoutes(app, {
    verify: options.verify ?? createAuthVerifier(options.config),
    service: options.service ?? new MemoryExecutionService(),
  });
  return app;
}
