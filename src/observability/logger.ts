import type { FastifyBaseLogger } from 'fastify';
import pino from 'pino';
import { redact } from '../security/redaction.js';

export function createLogger(level = 'info'): FastifyBaseLogger {
  return pino({
    level,
    base: { service: 'z-x-execution-runner' },
    formatters: { log: (object) => redact(object) as Record<string, unknown> },
  }) as FastifyBaseLogger;
}
