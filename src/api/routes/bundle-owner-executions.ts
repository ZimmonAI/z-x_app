import { Readable } from 'node:stream';
import type { FastifyInstance } from 'fastify';
import { authenticate, requireScope, type AuthVerifier, type Principal } from '../auth.js';
import type { BundleOwnerExecutionService } from '../../bundle-execution/v1/service.js';

async function principal(
  request: Parameters<typeof authenticate>[0],
  verify: AuthVerifier,
  scope: string,
): Promise<Principal> {
  const authenticated = await authenticate(request, verify);
  requireScope(authenticated, scope);
  return authenticated;
}

export async function bundleOwnerExecutionRoutes(
  app: FastifyInstance,
  options: { verify: AuthVerifier; service: BundleOwnerExecutionService },
): Promise<void> {
  app.post('/internal/v1/bundle-executions', async (request, reply) => {
    const actor = await principal(request, options.verify, 'zx.bundle-executions.submit');
    const result = await options.service.submit(actor.ownerApp, request.body);
    return reply.code(result.code).send(result.execution);
  });

  app.get('/internal/v1/bundle-executions/:executionId', async (request, reply) => {
    const actor = await principal(request, options.verify, 'zx.bundle-executions.read');
    const executionId = (request.params as { executionId: string }).executionId;
    const execution = await options.service.get(actor.ownerApp, executionId);
    return execution ?? reply.code(404).send({ error: 'not found' });
  });

  app.get(
    '/internal/v1/bundle-executions/:executionId/artifacts/:artifactRef',
    async (request, reply) => {
      const actor = await principal(
        request,
        options.verify,
        'zx.bundle-executions.artifacts.read',
      );
      const { executionId, artifactRef } = request.params as {
        executionId: string;
        artifactRef: string;
      };
      const artifact = await options.service.readArtifact(
        actor.ownerApp,
        executionId,
        artifactRef,
      );
      if (!artifact) return reply.code(404).send({ error: 'not found' });

      reply.header('content-type', artifact.descriptor.mimeType);
      reply.header('content-length', String(artifact.descriptor.sizeBytes));
      reply.header('cache-control', 'private, no-store');
      reply.header('x-zx-artifact-ref', artifact.descriptor.artifactRef);
      if (artifact.descriptor.checksumSha256) {
        reply.header('x-zx-checksum-sha256', artifact.descriptor.checksumSha256);
      }
      return reply.send(Readable.from([artifact.bytes]));
    },
  );
}
