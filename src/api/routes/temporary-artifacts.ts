import { createReadStream } from 'node:fs';
import type pg from 'pg';
import type { FastifyInstance } from 'fastify';
import type { Readable } from 'node:stream';
import type { AuthVerifier } from '../auth.js';
import { authenticate, requireScope } from '../auth.js';

export interface TemporaryArtifactContent {
  id: string;
  mimeType: string;
  safeFileName?: string;
  byteSize?: number;
  body: Readable;
}

export interface TemporaryArtifactReadService {
  open(clientKey: string, artifactId: string): Promise<TemporaryArtifactContent | null>;
}

export class UnavailableTemporaryArtifactReadService implements TemporaryArtifactReadService {
  async open(): Promise<null> {
    return null;
  }
}

export class PostgresTemporaryArtifactReadService implements TemporaryArtifactReadService {
  constructor(private readonly pool: pg.Pool) {}

  async open(clientKey: string, artifactId: string): Promise<TemporaryArtifactContent | null> {
    const result = await this.pool.query<{
      id: string;
      backend_kind: string;
      internal_location: string;
      safe_file_name: string | null;
      mime_type: string;
      byte_size: string | number | null;
    }>(
      `select id, backend_kind, internal_location, safe_file_name, mime_type, byte_size
         from execution.temporary_artifacts
        where id=$1
          and owner_ref=$2
          and state in ('available','retrieving')
          and expires_at > now()`,
      [artifactId, clientKey],
    );
    const row = result.rows[0];
    if (!row) return null;

    // Physical custody remains an internal concern. The public API never exposes
    // internal_location. Additional backend kinds can be registered behind this
    // interface without changing the Request or handback contract.
    if (!['filesystem', 'local-file'].includes(row.backend_kind)) {
      throw Object.assign(new Error('temporary artifact backend is unavailable'), { statusCode: 503 });
    }

    const numericSize = row.byte_size === null ? undefined : Number(row.byte_size);
    return {
      id: row.id,
      mimeType: row.mime_type,
      ...(row.safe_file_name === null ? {} : { safeFileName: row.safe_file_name }),
      ...(numericSize === undefined || !Number.isSafeInteger(numericSize)
        ? {}
        : { byteSize: numericSize }),
      body: createReadStream(row.internal_location),
    };
  }
}

function contentDispositionFileName(value: string): string {
  return value.replace(/[\\"\r\n]/g, '_').slice(0, 255);
}

export async function temporaryArtifactRoutes(
  app: FastifyInstance,
  options: { verify: AuthVerifier; service: TemporaryArtifactReadService },
): Promise<void> {
  app.get('/internal/v1/temporary-artifacts/:zxTemporaryArtifactId/content', async (request, reply) => {
    const actor = await authenticate(request, options.verify);
    requireScope(actor, 'zx.temporary-artifacts.read');
    const id = (request.params as { zxTemporaryArtifactId: string }).zxTemporaryArtifactId;
    const artifact = await options.service.open(actor.clientKey, id);
    if (!artifact) return reply.code(404).send({ error: 'not found' });
    reply.header('content-type', artifact.mimeType);
    if (artifact.byteSize !== undefined) reply.header('content-length', artifact.byteSize);
    if (artifact.safeFileName) {
      reply.header(
        'content-disposition',
        `attachment; filename="${contentDispositionFileName(artifact.safeFileName)}"`,
      );
    }
    return reply.send(artifact.body);
  });
}
