import type { FastifyInstance } from 'fastify';
import type { AuthVerifier, Principal } from '../auth.js';
import { authenticate, requireScope } from '../auth.js';
import type { BundleOwnerExecutionService } from '../bundle-owner-execution-service.js';

async function principal(
  request: Parameters<typeof authenticate>[0],
  verify: AuthVerifier,
  scope: string,
): Promise<Principal> {
  const authenticated = await authenticate(request, verify);
  requireScope(authenticated, scope);
  return authenticated;
}

export async function bundleExecutionRoutes(
  app: FastifyInstance,
  options: { verify: AuthVerifier; service: BundleOwnerExecutionService },
): Promise<void> {
  app.post('/internal/v1/bundle-executions', async (request, reply) => {
    const actor = await principal(request, options.verify, 'zx.executions.submit');
    const result = await options.service.submit(actor.ownerApp, request.body);
    return reply.code(result.code).send(result.execution);
  });

  app.get('/internal/v1/bundle-executions/:executionId', async (request, reply) => {
    const actor = await principal(request, options.verify, 'zx.executions.read');
    const { executionId } = request.params as { executionId: string };
    const execution = await options.service.get(actor.ownerApp, executionId);
    return execution ?? reply.code(404).send({ error: 'not found' });
  });

  app.post('/internal/v1/bundle-executions/:executionId/cancel', async (request, reply) => {
    const actor = await principal(request, options.verify, 'zx.executions.cancel');
    const { executionId } = request.params as { executionId: string };
    const result = await options.service.cancel(actor.ownerApp, executionId);
    return result
      ? reply.code(result.code).send(result.execution)
      : reply.code(404).send({ error: 'not found' });
  });

  app.get('/internal/v1/bundle-executions/:executionId/artifacts/:artifactId', async (request, reply) => {
    const actor = await principal(request, options.verify, 'zx.executions.read');
    const { executionId, artifactId } = request.params as { executionId: string; artifactId: string };
    const artifact = await options.service.retrieveArtifact(actor.ownerApp, executionId, artifactId);
    if (!artifact) return reply.code(404).send({ error: 'not found' });
    reply.header('content-type', artifact.metadata.mimeType);
    reply.header('content-length', String(artifact.metadata.sizeBytes));
    if (artifact.metadata.checksumSha256) {
      reply.header('x-zx-checksum-sha256', artifact.metadata.checksumSha256);
    }
    reply.header('x-zx-artifact-expires-at', artifact.metadata.expiresAt);
    return reply.send(Buffer.from(artifact.bytes));
  });
}
