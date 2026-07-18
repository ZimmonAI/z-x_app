import { ZStorageHttpClient } from '../../src/clients/z-s-http.js';
import type { CompleteOutputV1 } from '../../src/contracts/v1/dependencies.js';
import { SafeExecutionError } from '../../src/contracts/v1/error.js';

const completionInput: CompleteOutputV1 = {
  executionId: 'execution-1',
  attemptId: 'attempt-1',
  authorizationRef: 'authorization-1',
  safeProviderOutputRef: 'provider-output-1',
  mimeType: 'image/png',
};

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function clientWithFetch(fetchImpl: typeof fetch, requestTimeoutMs = 15_000): ZStorageHttpClient {
  return new ZStorageHttpClient({
    baseUrl: 'https://z-s.example.test',
    bearerToken: 'server-only-token',
    fetchImpl,
    requestTimeoutMs,
  });
}

async function captureSafeError(promise: Promise<unknown>): Promise<SafeExecutionError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof SafeExecutionError) return error;
    throw error;
  }
  throw new Error('expected a safe execution error');
}

const malformedCases: Array<[string, () => Response]> = [
  [
    'oversized response',
    () =>
      new Response(JSON.stringify({ padding: 'x'.repeat(70_000) }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
  ],
  [
    'malformed JSON',
    () =>
      new Response('{', {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
  ],
  ['non-object JSON', () => jsonResponse([])],
  [
    'invalid content type',
    () =>
      new Response('not-json', {
        status: 200,
        headers: { 'content-type': 'text/plain' },
      }),
  ],
];

test.each(malformedCases)(
  '%s fails as a retryable malformed response',
  async (_label, responseFactory) => {
    const client = clientWithFetch(async () => responseFactory());
    const error = await captureSafeError(
      client.completeOrIngestOutput(completionInput, new AbortController().signal),
    );
    expect(error.safe).toMatchObject({
      family: 'malformed-output',
      code: 'ZX_Z_S_MALFORMED_RESPONSE',
      retryable: true,
    });
  },
);

test.each([404, 501])(
  'HTTP %s maps to retryable Z-s output not-ready',
  async (status) => {
    const client = clientWithFetch(async () => jsonResponse({ code: 'IGNORED' }, status));
    const error = await captureSafeError(
      client.completeOrIngestOutput(completionInput, new AbortController().signal),
    );
    expect(error.safe).toMatchObject({
      family: 'storage-output-failure',
      code: 'ZX_Z_S_OUTPUT_NOT_READY',
      retryable: true,
    });
  },
);

test('an explicit not-ready code maps to the owned retryable code', async () => {
  const client = clientWithFetch(async () => jsonResponse({ code: 'not-ready' }, 503));
  const error = await captureSafeError(
    client.completeOrIngestOutput(completionInput, new AbortController().signal),
  );
  expect(error.safe).toMatchObject({
    code: 'ZX_Z_S_OUTPUT_NOT_READY',
    retryable: true,
  });
});

test('authentication rejection is non-retryable', async () => {
  const client = clientWithFetch(async () => jsonResponse({ code: 'ZX_AUTH_DENIED' }, 401));
  const error = await captureSafeError(
    client.completeOrIngestOutput(completionInput, new AbortController().signal),
  );
  expect(error.safe).toMatchObject({
    family: 'storage-output-failure',
    code: 'ZX_AUTH_DENIED',
    retryable: false,
  });
});

test('server failure remains retryable even when the envelope says otherwise', async () => {
  const client = clientWithFetch(async () =>
    jsonResponse({ error: { code: 'ZX_UPSTREAM_FAILURE', retryable: false } }, 500),
  );
  const error = await captureSafeError(
    client.completeOrIngestOutput(completionInput, new AbortController().signal),
  );
  expect(error.safe).toMatchObject({
    family: 'storage-output-failure',
    code: 'ZX_UPSTREAM_FAILURE',
    retryable: true,
  });
});

test('raw response bodies and bearer tokens never appear in thrown errors', async () => {
  const bearerToken = 'do-not-expose-bearer-token';
  const rawBodySecret = 'do-not-expose-response-body';
  const fetchImpl: typeof fetch = async () =>
    jsonResponse(
      {
        code: 'ZX_UPSTREAM_FAILURE',
        retryable: true,
        diagnostic: `${rawBodySecret}:${bearerToken}`,
      },
      500,
    );
  const client = new ZStorageHttpClient({
    baseUrl: 'https://z-s.example.test',
    bearerToken,
    fetchImpl,
  });
  const error = await captureSafeError(
    client.completeOrIngestOutput(completionInput, new AbortController().signal),
  );
  const rendered = `${String(error)} ${JSON.stringify(error)}`;
  expect(rendered).not.toContain(rawBodySecret);
  expect(rendered).not.toContain(bearerToken);
});

test('caller abort is preserved without replacement', async () => {
  const fetchImpl: typeof fetch = async (_input, init) =>
    new Promise<Response>((_resolve, reject) => {
      const signal = init?.signal;
      if (!signal) {
        reject(new Error('missing signal'));
        return;
      }
      if (signal.aborted) {
        reject(signal.reason);
        return;
      }
      signal.addEventListener('abort', () => reject(signal.reason), { once: true });
    });
  const client = clientWithFetch(fetchImpl);
  const controller = new AbortController();
  const reason = new Error('caller cancelled');
  const request = client.completeOrIngestOutput(completionInput, controller.signal);
  controller.abort(reason);
  await expect(request).rejects.toBe(reason);
});

test('the client performs no hidden mutation retry', async () => {
  let calls = 0;
  const client = clientWithFetch(async () => {
    calls += 1;
    return jsonResponse({ code: 'ZX_UPSTREAM_FAILURE', retryable: true }, 500);
  });
  await expect(
    client.completeOrIngestOutput(completionInput, new AbortController().signal),
  ).rejects.toBeInstanceOf(SafeExecutionError);
  expect(calls).toBe(1);
});

test('the bounded request timeout maps safely and performs one request', async () => {
  let calls = 0;
  const fetchImpl: typeof fetch = async (_input, init) => {
    calls += 1;
    return new Promise<Response>((_resolve, reject) => {
      const signal = init?.signal;
      signal?.addEventListener('abort', () => reject(signal.reason), { once: true });
    });
  };
  const client = clientWithFetch(fetchImpl, 1);
  const error = await captureSafeError(
    client.completeOrIngestOutput(completionInput, new AbortController().signal),
  );
  expect(error.safe).toMatchObject({
    family: 'timeout',
    code: 'ZX_Z_S_REQUEST_TIMEOUT',
    retryable: true,
  });
  expect(calls).toBe(1);
});
