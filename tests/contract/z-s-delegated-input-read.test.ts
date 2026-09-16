import { describe, expect, it } from 'vitest';
import { ZStorageExactObjectHttpClient } from '../../src/clients/z-s-exact-object-read.js';

interface CapturedRequest {
  url: string;
  init: RequestInit;
}

function objectResponse(
  bytes = new Uint8Array([1, 2, 3, 4]),
  headers: Record<string, string> = {},
): Response {
  return new Response(bytes, {
    status: 200,
    headers: {
      'content-type': 'image/png',
      'content-length': String(bytes.byteLength),
      etag: `"${'a'.repeat(64)}"`,
      ...headers,
    },
  });
}

function createClient(responseFactory: () => Response): {
  client: ZStorageExactObjectHttpClient;
  requests: CapturedRequest[];
} {
  const requests: CapturedRequest[] = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    requests.push({ url: String(input), init: init ?? {} });
    return responseFactory();
  };
  return {
    client: new ZStorageExactObjectHttpClient({
      baseUrl: 'https://z-s.example.test///',
      bearerToken: 'z-x-service-only-token',
      fetchImpl,
    }),
    requests,
  };
}

const input = {
  executionId: 'execution-1',
  attemptId: 'attempt-1',
  storageObjectId: '018f8f6c-7d2e-7a11-8e5a-123456789abc',
  readAuthorityRef: 'zsauth_read_01HZX8R3Q5',
};

describe('delegated Z-s exact-object input read', () => {
  it('uses the exact owner-selected object route with separate Z-X service and delegated authority', async () => {
    const { client, requests } = createClient(() => objectResponse());

    const result = await client.readExactObject(input, new AbortController().signal);
    expect(result).toMatchObject({
      storageObjectId: input.storageObjectId,
      mimeType: 'image/png',
      sizeBytes: 4,
      checksumSha256: 'a'.repeat(64),
    });
    expect(new Uint8Array(await new Response(result.body).arrayBuffer())).toEqual(
      new Uint8Array([1, 2, 3, 4]),
    );

    expect(requests).toHaveLength(1);
    const request = requests[0];
    if (!request) throw new Error('request was not captured');
    expect(request.url).toBe(
      `https://z-s.example.test/v1/storage-objects/${input.storageObjectId}/content`,
    );
    expect(request.init.method).toBe('GET');
    expect(request.init.redirect).toBe('error');
    expect(request.init.credentials).toBe('omit');
    const headers = new Headers(request.init.headers);
    expect(headers.get('authorization')).toBe('Bearer z-x-service-only-token');
    expect(headers.get('x-zs-read-grant-token')).toBe(input.readAuthorityRef);
    expect(headers.get('x-zs-caller-app')).toBe('z-x_app');
    expect(headers.get('x-zs-contract-version')).toBe('1.0');
    expect(headers.get('x-app-correlation-reference')).toBe(
      'zx-input-read:execution-1:attempt-1',
    );
    expect(headers.get('accept')).toBe('*/*');
  });

  it.each([
    [404, 'ZX_Z_S_INPUT_NOT_FOUND', false],
    [409, 'ZX_Z_S_INPUT_NOT_READY', true],
    [410, 'ZX_Z_S_INPUT_UNAVAILABLE', false],
  ] as const)(
    'fails truthfully for exact-object status %s without trying an alternate object',
    async (status, code, retryable) => {
      const { client, requests } = createClient(() => new Response(null, { status }));
      await expect(client.readExactObject(input, new AbortController().signal)).rejects.toMatchObject({
        safe: { family: 'storage-input-failure', code, retryable },
      });
      expect(requests).toHaveLength(1);
      expect(requests[0]?.url).toContain(`/${input.storageObjectId}/content`);
    },
  );

  it('rejects provider/private location leakage instead of following it', async () => {
    const { client } = createClient(() =>
      objectResponse(undefined, { location: 'https://provider.invalid/private-object' }),
    );
    await expect(client.readExactObject(input, new AbortController().signal)).rejects.toMatchObject({
      safe: {
        family: 'storage-input-failure',
        code: 'ZX_Z_S_INPUT_RESPONSE_INVALID',
        retryable: false,
      },
    });
  });

  it('enforces the verified response byte length while the script consumes the stream', async () => {
    const { client } = createClient(() =>
      objectResponse(new Uint8Array([1, 2, 3, 4]), { 'content-length': '3' }),
    );
    const result = await client.readExactObject(input, new AbortController().signal);
    await expect(new Response(result.body).arrayBuffer()).rejects.toMatchObject({
      safe: {
        family: 'storage-input-failure',
        code: 'ZX_Z_S_INPUT_LENGTH_MISMATCH',
      },
    });
  });
});
