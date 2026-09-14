import { Readable } from 'node:stream';
import type { FastifyInstance } from 'fastify';
import type { AuthVerifier } from '../auth.js';
import { authenticate, requireScope } from '../auth.js';
import type { BundleOwnerExecutionService } from '../bundle-owner-execution-service.js';

class FixedWindowRateLimiter {
  private readonly windows = new Map<string, { startedAt: number; count: number }>();

  consume(key: string, limit: number, durationMilliseconds: number): void {
    const now = Date.now();
    const existing = this.windows.get(key);
    if (!existing || now - existing.startedAt >= durationMilliseconds) {
      this.windows.set(key, { startedAt: now, count: 1 });
      return;
    }
    if (existing.count >= limit) {
      throw Object.assign(new Error('rate limit exceeded'), { statusCode: 429 });
    }
    existing.count += 1;
  }
}

export async function bundleArtifactRoutes(
  app: FastifyInstance,
  options: { verify: AuthVerifier; service: BundleOwnerExecutionService },
): Promise<void> {
  const limiter = new FixedWindowRateLimiter();

  app.get('/internal/v1/executions/:executionId/artifacts/:artifactId', async (request, reply) => {
    const actor = await authenticate(request, options.verify);
    requireScope(actor, 'zx.executions.read');
    limiter.consume(`${actor.ownerApp}:artifact-read`, 120, 60_000);

    const { executionId, artifactId } = request.params as {
      executionId: string;
      artifactId: string;
    };
    const artifact = await options.service.retrieveArtifact(actor.ownerApp, executionId, artifactId);
    if (!artifact) return reply.code(404).send({ error: 'not found' });

    reply.header('content-type', artifact.metadata.mimeType);
    reply.header('content-length', String(artifact.metadata.sizeBytes));
    if (artifact.metadata.checksumSha256) {
      reply.header('x-zx-checksum-sha256', artifact.metadata.checksumSha256);
    }
    reply.header('x-zx-artifact-expires-at', artifact.metadata.expiresAt);
    return reply.send(Readable.from([Buffer.from(artifact.bytes)]));
  });
}
