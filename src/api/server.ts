import Fastify from 'fastify';
import { ZodError } from 'zod';
import type { Config } from '../config.js';
import { createLogger } from '../observability/logger.js';
import { createPool, migrationCurrent } from '../persistence/pool.js';
import { createAuthVerifier, type AuthVerifier } from './auth.js';
import {
  MemoryRequestService,
  PostgresRequestService,
  requestRoutes,
  type RequestService,
} from './routes/requests.js';
import {
  PostgresTemporaryArtifactReadService,
  temporaryArtifactRoutes,
  UnavailableTemporaryArtifactReadService,
  type TemporaryArtifactReadService,
} from './routes/temporary-artifacts.js';
import { healthRoutes } from './routes/health.js';
import { readinessRoutes } from './routes/readiness.js';

const MAX_RESPONSE_BYTES = 512 * 1024;

function isDatabaseError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const code = (error as { code?: unknown }).code;
  return typeof code === 'string' && /^[0-9A-Z]{5}$/.test(code);
}

export async function buildServer(options: {
  config: Config;
  verify?: AuthVerifier;
  requestService?: RequestService;
  artifactService?: TemporaryArtifactReadService;
  ready?: () => Promise<boolean>;
}) {
  const app = Fastify({
    loggerInstance: createLogger(options.config.ZX_LOG_LEVEL),
    bodyLimit: 256 * 1024,
  });

  let secondStartedAt = Date.now();
  let globalRequestCount = 0;
  app.addHook('onRequest', async () => {
    const now = Date.now();
    if (now - secondStartedAt >= 1_000) {
      secondStartedAt = now;
      globalRequestCount = 0;
    }
    if (globalRequestCount >= 200) {
      throw Object.assign(new Error('rate limit exceeded'), { statusCode: 429 });
    }
    globalRequestCount += 1;
  });

  app.addHook('onSend', async (_request, _reply, payload) => {
    const responseBytes =
      typeof payload === 'string' || Buffer.isBuffer(payload)
        ? Buffer.byteLength(payload)
        : 0;
    if (responseBytes > MAX_RESPONSE_BYTES) {
      throw Object.assign(new Error('response exceeds 512 KiB'), { statusCode: 500 });
    }
    return payload;
  });

  app.setErrorHandler((error, _request, reply) => {
    const explicitStatus = (error as { statusCode?: number }).statusCode;
    const statusCode =
      explicitStatus ?? (error instanceof ZodError ? 400 : isDatabaseError(error) ? 503 : 500);
    const message =
      statusCode >= 500
        ? statusCode === 503
          ? 'service unavailable'
          : 'internal safe failure'
        : error instanceof Error
          ? error.message
          : 'request failed';
    void reply.code(statusCode).send({ error: message });
  });

  const injectedPersistence = options.requestService !== undefined && options.artifactService !== undefined;
  const pool = injectedPersistence || !options.config.ZX_DATABASE_URL
    ? undefined
    : createPool(options.config.ZX_DATABASE_URL);

  const requestService =
    options.requestService ??
    (pool
      ? new PostgresRequestService(pool)
      : options.config.ZX_NODE_ENV === 'test'
        ? new MemoryRequestService()
        : undefined);
  if (!requestService) {
    throw new Error('ZX_DATABASE_URL required outside explicit test service injection');
  }

  const artifactService =
    options.artifactService ??
    (pool
      ? new PostgresTemporaryArtifactReadService(pool)
      : options.config.ZX_NODE_ENV === 'test'
        ? new UnavailableTemporaryArtifactReadService()
        : undefined);
  if (!artifactService) {
    throw new Error('temporary artifact persistence required outside tests');
  }

  const verify = options.verify ?? createAuthVerifier(options.config);
  const ready =
    options.ready ??
    (pool
      ? async () => {
          try {
            return await migrationCurrent(pool);
          } catch {
            return false;
          }
        }
      : async () => options.config.ZX_NODE_ENV === 'test');

  if (pool) {
    app.addHook('onClose', async () => {
      await pool.end();
    });
  }

  await healthRoutes(app);
  await readinessRoutes(app, { ready });
  await requestRoutes(app, { verify, service: requestService });
  await temporaryArtifactRoutes(app, { verify, service: artifactService });
  return app;
}
