import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { ZStorageDelegatedOutputHttpClient } from '../../src/clients/z-s-delegated-output.js';

const writeIntentId = '019a55c1-7ad0-7000-8000-000000000001';
const storageObjectId = '019a55c1-7ad0-7000-8000-000000000002';
const bytes = new TextEncoder().encode('owner-authorized-output');
const checksumSha256 = createHash('sha256').update(bytes).digest('hex');

function artifact() {
  return {
    artifactRef: 'zx-temp:artifact-1',
    mimeType: 'image/png',
    sizeBytes: bytes.byteLength,
    checksumSha256,
    body: new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(bytes);
        controller.close();
      },
    }),
  };
}

function responseResult(extra: Record<string, unknown> = {}) {
  return {
    serviceId: 'z-s',
    packageVersion: '1.2.1',
    contractVersion: '1.0',
    appCorrelationReference: 'zx-output-write:execution-1:attempt-1',
    result: {
      storageObjectId,
      writeIntentId,
      state: 'verified',
      checksumSha256,
      byteLength: bytes.byteLength,
      integrityVerification: { state: 'verified' },
      objectProtectionStage: 'protected',
      storageState: 'ready',
      verifiedMedia: {
        mediaType: 'image/png',
        mediaFamily: 'image',
        image: { width: 1024, height: 768 },
      },
      duplicateProtection: { key: 'safe-key', replayed: false },
      ...extra,
    },
  };
}

async function requestBody(init: RequestInit | undefined): Promise<Uint8Array> {
  const body = init?.body;
  if (!(body instanceof ReadableStream)) throw new Error('stream body missing');
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

describe('delegated Z-s output write', () => {
  it('uploads exact artifact bytes to the exact owner-authorized write intent', async () => {
    let capturedUrl = '';
    let capturedInit: RequestInit | undefined;
    let uploaded: Uint8Array<ArrayBufferLike> = new Uint8Array();
    const fetchImpl: typeof fetch = async (input, init) => {
      capturedUrl = String(input);
      capturedInit = init;
      uploaded = await requestBody(init);
      return new Response(JSON.stringify(responseResult()), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    };
    const client = new ZStorageDelegatedOutputHttpClient({
      baseUrl: 'https://z-s.example.test/',
      bearerToken: 'z-x-service-bearer',
      fetchImpl,
    });

    const result = await client.writeDelegatedOutput(
      {
        executionId: 'execution-1',
        attemptId: 'attempt-1',
        writeIntentId,
        writeAuthorityRef: 'owner_bounded_upload_capability',
        artifact: artifact(),
      },
      new AbortController().signal,
    );

    expect(capturedUrl).toBe(
      `https://z-s.example.test/v1/object-write-intents/${writeIntentId}/content`,
    );
    expect(capturedInit?.method).toBe('PUT');
    const headers = new Headers(capturedInit?.headers);
    expect(headers.get('authorization')).toBe('Bearer z-x-service-bearer');
    expect(headers.get('x-zs-upload-completion-token')).toBe(
      'owner_bounded_upload_capability',
    );
    expect(headers.get('x-zs-caller-app')).toBe('z-x_app');
    expect(headers.get('content-type')).toBe('image/png');
    expect(headers.get('content-length')).toBe(String(bytes.byteLength));
    expect(headers.get('x-content-sha256')).toBe(checksumSha256);
    expect(uploaded).toEqual(bytes);
    expect(result).toMatchObject({
      storageObjectId,
      writeIntentId,
      checksumSha256,
      mimeType: 'image/png',
      sizeBytes: bytes.byteLength,
      width: 1024,
      height: 768,
      storageState: 'ready',
    });
    expect(JSON.stringify(result)).not.toContain('owner_bounded_upload_capability');
  });

  it('rejects provider-private leakage and mismatched durable evidence', async () => {
    const privateClient = new ZStorageDelegatedOutputHttpClient({
      baseUrl: 'https://z-s.example.test',
      bearerToken: 'z-x-service-bearer',
      fetchImpl: async () =>
        new Response(JSON.stringify(responseResult({ bucket: 'private-bucket' })), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
    });
    await expect(
      privateClient.writeDelegatedOutput(
        {
          executionId: 'execution-1',
          attemptId: 'attempt-1',
          writeIntentId,
          writeAuthorityRef: 'owner_bounded_upload_capability',
          artifact: artifact(),
        },
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({ safe: { code: 'ZX_Z_S_DELEGATED_WRITE_MALFORMED_RESPONSE' } });

    const mismatchClient = new ZStorageDelegatedOutputHttpClient({
      baseUrl: 'https://z-s.example.test',
      bearerToken: 'z-x-service-bearer',
      fetchImpl: async () =>
        new Response(
          JSON.stringify(responseResult({ checksumSha256: 'f'.repeat(64) })),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
    });
    await expect(
      mismatchClient.writeDelegatedOutput(
        {
          executionId: 'execution-1',
          attemptId: 'attempt-1',
          writeIntentId,
          writeAuthorityRef: 'owner_bounded_upload_capability',
          artifact: artifact(),
        },
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({ safe: { family: 'malformed-output' } });
  });

  it('keeps dependency failures retryable against the same write intent', async () => {
    const client = new ZStorageDelegatedOutputHttpClient({
      baseUrl: 'https://z-s.example.test',
      bearerToken: 'z-x-service-bearer',
      fetchImpl: async () => new Response(null, { status: 503 }),
    });
    await expect(
      client.writeDelegatedOutput(
        {
          executionId: 'execution-1',
          attemptId: 'attempt-1',
          writeIntentId,
          writeAuthorityRef: 'owner_bounded_upload_capability',
          artifact: artifact(),
        },
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({
      safe: { code: 'ZX_Z_S_DELEGATED_WRITE_RETRYABLE_FAILURE', retryable: true },
    });
  });
});
