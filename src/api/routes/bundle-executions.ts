import type { FastifyInstance } from 'fastify';
import {
  BundleExecutionSubmitRequestSchema,
  type BundleArtifactDownload,
  type BundleExecutionCancelResponse,
  type BundleExecutionSubmitRequest,
  type BundleExecutionView,
} from '../../contracts/bundle/v1/execution.js';
import { authenticate, requireScope, type AuthVerifier } from '../auth.js';

export interface BundleExecutionSubmitResult {
  code: 200 | 202;
  execution: BundleExecutionView;
}

export interface BundleExecutionService {
  submit(ownerApp: string, request: BundleExecutionSubmitRequest): Promise<BundleExecutionSubmitResult>;
  get(ownerApp: string, executionId: string): Promise<BundleExecutionView | null>;
  cancel(ownerApp: string, executionId: string): Promise<BundleExecutionCancelResponse | null>;
  getArtifact(
    ownerApp: string,
    executionId: string,
    artifactId: string,
  ): Promise<BundleArtifactDownload | null>;
}

export class UnavailableBundleExecutionService implements BundleExecutionService {
  private unavailable(): never {
    throw Object.assign(
      new Error('immutable bundle execution runtime is not configured'),
      { statusCode: 503 },
    );
  }

  async submit(_ownerApp: string, _request: BundleExecutionSubmitRequest) {
    return this.unavailable();
  }

  async get(_ownerApp: string, _executionId: string) {
    return this.unavailable();
  }

  async cancel(_ownerApp: string, _executionId: string) {
    return this.unavailable();
  }

  async getArtifact(_ownerApp: string, _executionId: string, _artifactId: string) {
    return this.unavailable();
  }
}

async function owner(request: Parameters<typeof authenticate>[0], verify: AuthVerifier, scope: string) {
  const principal = await authenticate(request, verify);
  requireScope(principal, scope);
  return principal.ownerApp;
}

export async function bundleExecutionRoutes(
  app: FastifyInstance,
  options: { verify: AuthVerifier; service: BundleExecutionService },
): Promise<void> {
  app.post('/internal/v1/bundle-executions', async (request, reply) => {
    const ownerApp = await owner(request, options.verify, 'zx.executions.submit');
    const parsed = BundleExecutionSubmitRequestSchema.parse(request.body);
    const result = await options.service.submit(ownerApp, parsed);
    return reply.code(result.code).send(result.execution);
  });

  app.get('/internal/v1/bundle-executions/:executionId', async (request, reply) => {
    const ownerApp = await owner(request, options.verify, 'zx.executions.read');
    const executionId = (request.params as { executionId: string }).executionId;
    const execution = await options.service.get(ownerApp, executionId);
    return execution ?? reply.code(404).send({ error: 'not found' });
  });

  app.post('/internal/v1/bundle-executions/:executionId/cancel', async (request, reply) => {
    const ownerApp = await owner(request, options.verify, 'zx.executions.cancel');
    const executionId = (request.params as { executionId: string }).executionId;
    const result = await options.service.cancel(ownerApp, executionId);
    return result ?? reply.code(404).send({ error: 'not found' });
  });

  app.get(
    '/internal/v1/bundle-executions/:executionId/artifacts/:artifactId',
    async (request, reply) => {
      const ownerApp = await owner(request, options.verify, 'zx.executions.read');
      const { executionId, artifactId } = request.params as {
        executionId: string;
        artifactId: string;
      };
      const artifact = await options.service.getArtifact(ownerApp, executionId, artifactId);
      if (!artifact) return reply.code(404).send({ error: 'not found' });
      if (Date.parse(artifact.expiresAt) <= Date.now()) {
        return reply.code(410).send({ error: 'artifact expired' });
      }
      reply.header('content-type', artifact.mimeType);
      reply.header('cache-control', 'private, no-store');
      reply.header('content-length', String(artifact.sizeBytes ?? artifact.bytes.byteLength));
      reply.header('x-zx-artifact-expires-at', artifact.expiresAt);
      if (artifact.checksumSha256) {
        reply.header('x-zx-artifact-sha256', artifact.checksumSha256);
      }
      return reply.send(Buffer.from(artifact.bytes));
    },
  );
}
