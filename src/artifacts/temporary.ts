import { createHash, randomUUID } from 'node:crypto';
import { SafeExecutionError } from '../contracts/v1/error.js';

export interface TemporaryArtifactScopeV1 {
  ownerApp: string;
  ownerProjectId?: string;
  executionId: string;
  attemptId: string;
}

export interface CaptureTemporaryArtifactV1 extends TemporaryArtifactScopeV1 {
  safeSourceRef: string;
  expectedMimeType: string;
  maxBytes?: number;
}

export interface TemporaryArtifactSnapshotV1 extends TemporaryArtifactScopeV1 {
  artifactRef: string;
  mimeType: string;
  sizeBytes: number;
  checksumSha256: string;
  expiresAt: string;
}

export interface TemporaryArtifactReadV1 extends TemporaryArtifactSnapshotV1 {
  body: ReadableStream<Uint8Array>;
}

export interface TemporaryArtifactClient {
  capture(
    input: Readonly<CaptureTemporaryArtifactV1>,
    signal: AbortSignal,
  ): Promise<Readonly<TemporaryArtifactSnapshotV1>>;
  open(
    input: Readonly<TemporaryArtifactScopeV1 & { artifactRef: string }>,
    signal: AbortSignal,
  ): Promise<Readonly<TemporaryArtifactReadV1>>;
  cleanupExpired(now?: Date): Promise<number>;
}

export interface TemporaryArtifactMaterializationV1 {
  mimeType: string;
  body: ReadableStream<Uint8Array>;
}

export type TemporaryArtifactMaterializer = (
  safeSourceRef: string,
  signal: AbortSignal,
) => Promise<Readonly<TemporaryArtifactMaterializationV1>>;

interface StoredArtifact {
  snapshot: Readonly<TemporaryArtifactSnapshotV1>;
  bytes: Uint8Array;
}

function safeError(code: string, message: string, retryable: boolean): SafeExecutionError {
  return new SafeExecutionError({
    family: 'storage-output-failure',
    code,
    message,
    retryable,
    traceId: 'temporary-artifact',
  });
}

function sameScope(
  left: Readonly<TemporaryArtifactScopeV1>,
  right: Readonly<TemporaryArtifactScopeV1>,
): boolean {
  return (
    left.ownerApp === right.ownerApp &&
    (left.ownerProjectId ?? '') === (right.ownerProjectId ?? '') &&
    left.executionId === right.executionId &&
    left.attemptId === right.attemptId
  );
}

async function readBoundedBody(
  body: ReadableStream<Uint8Array>,
  maximumBytes: number,
  signal: AbortSignal,
): Promise<Uint8Array> {
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      if (signal.aborted) throw signal.reason ?? new DOMException('Aborted', 'AbortError');
      const next = await reader.read();
      if (next.done) break;
      if (next.value === undefined) continue;
      total += next.value.byteLength;
      if (total > maximumBytes) {
        await reader.cancel().catch(() => undefined);
        throw safeError(
          'ZX_TEMP_ARTIFACT_TOO_LARGE',
          'the produced artifact exceeded its owner-authorized byte bound',
          false,
        );
      }
      chunks.push(next.value);
    }
  } finally {
    try {
      reader.releaseLock();
    } catch {
      // Stream cancellation may already release the reader.
    }
  }

  if (total <= 0) {
    throw safeError('ZX_TEMP_ARTIFACT_EMPTY', 'the produced artifact was empty', false);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

/**
 * Test/runtime-neutral reference implementation. Production runtimes may replace
 * the physical backend while preserving the same owner-scoped artifact contract.
 */
export class InMemoryTemporaryArtifactStore implements TemporaryArtifactClient {
  readonly #materialize: TemporaryArtifactMaterializer;
  readonly #ttlMs: number;
  readonly #now: () => Date;
  readonly #createId: () => string;
  readonly #records = new Map<string, StoredArtifact>();

  constructor(options: {
    materialize: TemporaryArtifactMaterializer;
    ttlMs?: number;
    now?: () => Date;
    createId?: () => string;
  }) {
    this.#materialize = options.materialize;
    this.#ttlMs = options.ttlMs ?? 15 * 60_000;
    if (!Number.isSafeInteger(this.#ttlMs) || this.#ttlMs < 1_000 || this.#ttlMs > 24 * 60 * 60_000) {
      throw new TypeError('temporary artifact ttl is invalid');
    }
    this.#now = options.now ?? (() => new Date());
    this.#createId = options.createId ?? randomUUID;
  }

  async capture(
    input: Readonly<CaptureTemporaryArtifactV1>,
    signal: AbortSignal,
  ): Promise<Readonly<TemporaryArtifactSnapshotV1>> {
    const maximumBytes = input.maxBytes ?? 2 * 1024 * 1024 * 1024;
    if (!Number.isSafeInteger(maximumBytes) || maximumBytes <= 0) {
      throw safeError('ZX_TEMP_ARTIFACT_BOUND_INVALID', 'the temporary artifact byte bound is invalid', false);
    }
    const materialized = await this.#materialize(input.safeSourceRef, signal);
    if (materialized.mimeType !== input.expectedMimeType) {
      throw safeError(
        'ZX_TEMP_ARTIFACT_MIME_MISMATCH',
        'the produced artifact MIME did not match the frozen execution contract',
        false,
      );
    }
    const bytes = await readBoundedBody(materialized.body, maximumBytes, signal);
    const artifactRef = `zx-temp:${this.#createId()}`;
    const expiresAt = new Date(this.#now().getTime() + this.#ttlMs).toISOString();
    const snapshot: TemporaryArtifactSnapshotV1 = Object.freeze({
      artifactRef,
      ownerApp: input.ownerApp,
      ...(input.ownerProjectId === undefined ? {} : { ownerProjectId: input.ownerProjectId }),
      executionId: input.executionId,
      attemptId: input.attemptId,
      mimeType: materialized.mimeType,
      sizeBytes: bytes.byteLength,
      checksumSha256: createHash('sha256').update(bytes).digest('hex'),
      expiresAt,
    });
    this.#records.set(artifactRef, { snapshot, bytes });
    return snapshot;
  }

  async open(
    input: Readonly<TemporaryArtifactScopeV1 & { artifactRef: string }>,
    signal: AbortSignal,
  ): Promise<Readonly<TemporaryArtifactReadV1>> {
    if (signal.aborted) throw signal.reason ?? new DOMException('Aborted', 'AbortError');
    const record = this.#records.get(input.artifactRef);
    if (!record || !sameScope(record.snapshot, input)) {
      throw safeError(
        'ZX_TEMP_ARTIFACT_NOT_FOUND',
        'the owner-scoped temporary artifact is unavailable',
        false,
      );
    }
    if (new Date(record.snapshot.expiresAt).getTime() <= this.#now().getTime()) {
      this.#records.delete(input.artifactRef);
      throw safeError('ZX_TEMP_ARTIFACT_EXPIRED', 'the temporary artifact has expired', false);
    }
    const bytes = record.bytes.slice();
    return Object.freeze({
      ...record.snapshot,
      body: new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(bytes);
          controller.close();
        },
      }),
    });
  }

  async cleanupExpired(now = this.#now()): Promise<number> {
    let removed = 0;
    for (const [artifactRef, record] of this.#records) {
      if (new Date(record.snapshot.expiresAt).getTime() <= now.getTime()) {
        this.#records.delete(artifactRef);
        removed += 1;
      }
    }
    return removed;
  }
}
