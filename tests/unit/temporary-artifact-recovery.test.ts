import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { InMemoryTemporaryArtifactStore } from '../../src/artifacts/temporary.js';

async function readAll(body: ReadableStream<Uint8Array>): Promise<Uint8Array> {
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const next = await reader.read();
    if (next.done) break;
    if (!next.value) continue;
    chunks.push(next.value);
    total += next.value.byteLength;
  }
  const output = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return output;
}

describe('temporary artifact recovery', () => {
  it('retains the same bounded bytes independently of the original provider connection', async () => {
    const bytes = new TextEncoder().encode('same-produced-output');
    let materializations = 0;
    const store = new InMemoryTemporaryArtifactStore({
      createId: () => 'artifact-1',
      materialize: async (safeSourceRef) => {
        materializations += 1;
        expect(safeSourceRef).toBe('provider-output-1');
        return {
          mimeType: 'image/png',
          body: new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(bytes);
              controller.close();
            },
          }),
        };
      },
    });
    const scope = {
      ownerApp: 'owner_app',
      ownerProjectId: 'project-1',
      executionId: 'execution-1',
      attemptId: 'attempt-1',
    };
    const captured = await store.capture(
      {
        ...scope,
        safeSourceRef: 'provider-output-1',
        expectedMimeType: 'image/png',
        maxBytes: 1024,
      },
      new AbortController().signal,
    );

    expect(captured.artifactRef).toBe('zx-temp:artifact-1');
    expect(captured.sizeBytes).toBe(bytes.byteLength);
    expect(captured.checksumSha256).toBe(createHash('sha256').update(bytes).digest('hex'));

    const first = await store.open(
      { ...scope, artifactRef: captured.artifactRef },
      new AbortController().signal,
    );
    const second = await store.open(
      { ...scope, artifactRef: captured.artifactRef },
      new AbortController().signal,
    );
    expect(await readAll(first.body)).toEqual(bytes);
    expect(await readAll(second.body)).toEqual(bytes);
    expect(materializations).toBe(1);
  });

  it('rejects cross-owner retrieval, byte overflow, and expired artifacts', async () => {
    const bytes = new TextEncoder().encode('12345');
    let now = new Date('2026-09-16T00:00:00.000Z');
    const store = new InMemoryTemporaryArtifactStore({
      ttlMs: 1_000,
      now: () => now,
      createId: () => 'artifact-2',
      materialize: async () => ({
        mimeType: 'image/png',
        body: new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(bytes);
            controller.close();
          },
        }),
      }),
    });
    const scope = {
      ownerApp: 'owner_app',
      executionId: 'execution-1',
      attemptId: 'attempt-1',
    };

    await expect(
      store.capture(
        {
          ...scope,
          safeSourceRef: 'provider-output-1',
          expectedMimeType: 'image/png',
          maxBytes: 4,
        },
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({ safe: { code: 'ZX_TEMP_ARTIFACT_TOO_LARGE' } });

    const captured = await store.capture(
      {
        ...scope,
        safeSourceRef: 'provider-output-1',
        expectedMimeType: 'image/png',
        maxBytes: 10,
      },
      new AbortController().signal,
    );
    await expect(
      store.open(
        { ...scope, ownerApp: 'other_owner', artifactRef: captured.artifactRef },
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({ safe: { code: 'ZX_TEMP_ARTIFACT_NOT_FOUND' } });

    now = new Date('2026-09-16T00:00:02.000Z');
    await expect(
      store.open(
        { ...scope, artifactRef: captured.artifactRef },
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({ safe: { code: 'ZX_TEMP_ARTIFACT_EXPIRED' } });
    expect(await store.cleanupExpired()).toBe(0);
  });
});
