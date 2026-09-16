import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { ZStorageDelegatedOutputHttpClient } from '../../src/clients/z-s-delegated-output.js';

const writeIntentId = '019a55c1-7ad0-7000-8000-000000000001';
const storageObjectId = '019a55c1-7ad0-7000-8000-000000000002';
const writeAuthorizationRef = 'owner_bounded_write_authorization';
const uploadCompletionToken = 'ephemeral_upload_completion_capability';
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

function intentResponse(extra: Record<string, unknown> = {}) {
  return {
    serviceId: 'z-s',
    packageVersion: '1.2.1',
    contractVersion: '1.0',
    appCorrelationReference: 'zx-output-write:execution-1:attempt-1',
    result: {
      writeIntentId,
      storageObjectId,
      state: 'accepted',
      uploadCompletionToken,
      expiresAt: '2026-09-16T09:15:00.000Z',
      objectProtectionStage: 'write-intent-created',
      duplicateProtection: { key: 'safe-intent-key', replayed: false },
      ...extra,
    },
  };
}

function completionResponse(extra: Record<string, unknown> = {}) {
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
      duplicateProtection: { key: 'safe-content-key', replayed: false },
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
  it('creates the exact intent after materialization without sending owner routing fields, then uploads exact bytes', async () => {
    const requests: Array<{ url: string; init: RequestInit | undefined }> = [];
    let uploaded: Uint8Array<ArrayBufferLike> = new Uint8Array();
    const fetchImpl: typeof fetch = async (input, init) => {
      const url = String(input);
      requests.push({ url, init });
      if (init?.method === 'POST') {
        return new Response(JSON.stringify(intentResponse()), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      uploaded = await requestBody(init);
      return new Response(JSON.stringify(completionResponse()), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    };
    const client = new ZStorageDelegatedOutputHttpClient({
      baseUrl: 'https://z-s.example.test/',
      bearerToken: 'z-x-service-bearer',
      fetchImpl,
    });

    const captured = artifact();
    const intent = await client.createDelegatedOutputWriteIntent(
      {
        executionId: 'execution-1',
        attemptId: 'attempt-1',
        writeAuthorizationRef,
        artifact: {
          artifactRef: captured.artifactRef,
          mimeType: captured.mimeType,
          sizeBytes: captured.sizeBytes,
          checksumSha256: captured.checksumSha256,
        },
      },
      new AbortController().signal,
    );

    expect(requests[0]?.url).toBe('https://z-s.example.test/v1/object-write-intents');
    expect(requests[0]?.init?.method).toBe('POST');
    const intentHeaders = new Headers(requests[0]?.init?.headers);
    expect(intentHeaders.get('authorization')).toBe('Bearer z-x-service-bearer');
    expect(intentHeaders.get('x-zs-write-authorization-token')).toBe(writeAuthorizationRef);
    expect(intentHeaders.get('x-zs-caller-app')).toBe('z-x_app');
    expect(intentHeaders.get('idempotency-key')).toBe(
      'zx-output-write:execution-1:attempt-1:intent',
    );
    expect(JSON.parse(String(requests[0]?.init?.body))).toEqual({
      mediaType: 'image/png',
      byteLength: bytes.byteLength,
      checksumSha256,
    });
    const serializedIntentRequest = String(requests[0]?.init?.body);
    for (const prohibited of [
      'storageProfile',
      'targetStorageServiceId',
      'sourceReference',
      'producerAudience',
      'bucket',
      'objectKey',
    ]) {
      expect(serializedIntentRequest).not.toContain(prohibited);
    }
    expect(intent).toEqual({
      writeIntentId,
      storageObjectId,
      uploadCompletionToken,
      expiresAt: '2026-09-16T09:15:00.000Z',
    });

    const result = await client.writeDelegatedOutput(
      {
        executionId: 'execution-1',
        attemptId: 'attempt-1',
        writeIntentId: intent.writeIntentId,
        writeAuthorityRef: intent.uploadCompletionToken,
        artifact: captured,
      },
      new AbortController().signal,
    );

    expect(requests[1]?.url).toBe(
      `https://z-s.example.test/v1/object-write-intents/${writeIntentId}/content`,
    );
    expect(requests[1]?.init?.method).toBe('PUT');
    const uploadHeaders = new Headers(requests[1]?.init?.headers);
    expect(uploadHeaders.get('x-zs-upload-completion-token')).toBe(uploadCompletionToken);
    expect(uploadHeaders.get('content-type')).toBe('image/png');
    expect(uploadHeaders.get('content-length')).toBe(String(bytes.byteLength));
    expect(uploadHeaders.get('x-content-sha256')).toBe(checksumSha256);
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
    expect(JSON.stringify(result)).not.toContain(uploadCompletionToken);
    expect(JSON.stringify(result)).not.toContain(writeAuthorizationRef);
  });

  it('rejects provider-private leakage from intent creation while allowing only the upload completion capability', async () => {
    const client = new ZStorageDelegatedOutputHttpClient({
      baseUrl: 'https://z-s.example.test',
      bearerToken: 'z-x-service-bearer',
      fetchImpl: async () =>
        new Response(JSON.stringify(intentResponse({ bucket: 'private-bucket' })), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
    });

    const captured = artifact();
    await expect(
      client.createDelegatedOutputWriteIntent(
        {
          executionId: 'execution-1',
          attemptId: 'attempt-1',
          writeAuthorizationRef,
          artifact: {
            artifactRef: captured.artifactRef,
            mimeType: captured.mimeType,
            sizeBytes: captured.sizeBytes,
            checksumSha256: captured.checksumSha256,
          },
        },
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({
      safe: { code: 'ZX_Z_S_DELEGATED_INTENT_MALFORMED_RESPONSE' },
    });
  });

  it('rejects provider-private leakage and mismatched durable completion evidence', async () => {
    const privateClient = new ZStorageDelegatedOutputHttpClient({
      baseUrl: 'https://z-s.example.test',
      bearerToken: 'z-x-service-bearer',
      fetchImpl: async () =>
        new Response(JSON.stringify(completionResponse({ bucket: 'private-bucket' })), {
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
          writeAuthorityRef: uploadCompletionToken,
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
          JSON.stringify(completionResponse({ checksumSha256: 'f'.repeat(64) })),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
    });
    await expect(
      mismatchClient.writeDelegatedOutput(
        {
          executionId: 'execution-1',
          attemptId: 'attempt-1',
          writeIntentId,
          writeAuthorityRef: uploadCompletionToken,
          artifact: artifact(),
        },
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({ safe: { family: 'malformed-output' } });
  });

  it('keeps dependency failures retryable for both intent creation and exact upload', async () => {
    const client = new ZStorageDelegatedOutputHttpClient({
      baseUrl: 'https://z-s.example.test',
      bearerToken: 'z-x-service-bearer',
      fetchImpl: async () => new Response(null, { status: 503 }),
    });
    const captured = artifact();

    await expect(
      client.createDelegatedOutputWriteIntent(
        {
          executionId: 'execution-1',
          attemptId: 'attempt-1',
          writeAuthorizationRef,
          artifact: {
            artifactRef: captured.artifactRef,
            mimeType: captured.mimeType,
            sizeBytes: captured.sizeBytes,
            checksumSha256: captured.checksumSha256,
          },
        },
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({
      safe: { code: 'ZX_Z_S_DELEGATED_WRITE_RETRYABLE_FAILURE', retryable: true },
    });

    await expect(
      client.writeDelegatedOutput(
        {
          executionId: 'execution-1',
          attemptId: 'attempt-1',
          writeIntentId,
          writeAuthorityRef: uploadCompletionToken,
          artifact: captured,
        },
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({
      safe: { code: 'ZX_Z_S_DELEGATED_WRITE_RETRYABLE_FAILURE', retryable: true },
    });
  });
});
