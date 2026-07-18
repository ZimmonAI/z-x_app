import { ZStorageHttpClient } from '../../src/clients/z-s-http.js';
import type {
  CompleteOutputV1,
  CreateOutputAuthorizationV1,
  ReconcileOutputV1,
} from '../../src/contracts/v1/dependencies.js';

interface CapturedRequest {
  url: string;
  init: RequestInit;
}

const futureExpiry = (): string => new Date(Date.now() + 60_000).toISOString();
const imageResult = () => ({
  resourceId: 'resource-1',
  resourceVersionId: 'version-1',
  storageIdentity: 'zs://resources/resource-1/version-1',
  checksumSha256: 'a'.repeat(64),
  mimeType: 'image/png',
  sizeBytes: 1024,
  width: 1024,
  height: 1024,
});

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function createClient(responseFactory: () => Response): {
  client: ZStorageHttpClient;
  requests: CapturedRequest[];
} {
  const requests: CapturedRequest[] = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    requests.push({ url: String(input), init: init ?? {} });
    return responseFactory();
  };
  return {
    client: new ZStorageHttpClient({
      baseUrl: 'https://z-s.example.test///',
      bearerToken: 'server-only-token',
      fetchImpl,
    }),
    requests,
  };
}

const authorizationInput: CreateOutputAuthorizationV1 = {
  executionId: 'execution-1',
  attemptId: 'attempt-1',
  mode: 'post-run-ingest',
  artifactKind: 'image',
  acceptedMimeTypes: ['image/png'],
  mimeType: 'image/png',
  storageProfileRef: 'zs-profile:generated-image',
  maxBytes: 4096,
  fixtureScenario: 'success',
};

const completionInput: CompleteOutputV1 = {
  executionId: 'execution-1',
  attemptId: 'attempt-1',
  authorizationRef: 'authorization-1',
  safeProviderOutputRef: 'provider-output-1',
  mimeType: 'image/png',
  fixtureScenario: 'success',
};

const reconciliationInput: ReconcileOutputV1 = {
  executionId: 'execution-1',
  attemptId: 'attempt-1',
  authorizationRef: 'authorization-1',
  safeProviderOutputRef: 'provider-output-1',
  mimeType: 'image/png',
  fixtureScenario: 'success',
};

const prohibitedCases: Array<[string, Record<string, unknown>]> = [
  ['credential', { credential: 'secret' }],
  ['token', { token: 'secret' }],
  ['signed URL', { signedUrl: 'https://storage.example.test/signed' }],
  ['provider URL', { providerUrl: 'https://provider.example.test/output' }],
  ['bucket', { bucket: 'private-bucket' }],
  ['object key', { objectKey: 'private/object.png' }],
  ['local path', { localPath: '/tmp/output.png' }],
];

test('authorization uses the frozen route, headers, body, correlation, and idempotency key', async () => {
  const { client, requests } = createClient(() =>
    jsonResponse({
      authorizationRef: 'authorization-1',
      uploadRef: 'upload-1',
      expiresAt: futureExpiry(),
    }),
  );

  await client.createOutputAuthorization(authorizationInput, new AbortController().signal);
  expect(requests).toHaveLength(1);
  const request = requests[0];
  if (!request) throw new Error('request was not captured');
  expect(request.url).toBe('https://z-s.example.test/v1/z-x/output-authorizations');
  expect(request.init.method).toBe('POST');
  expect(request.init.redirect).toBe('error');
  const headers = new Headers(request.init.headers);
  expect(headers.get('authorization')).toBe('Bearer server-only-token');
  expect(headers.get('x-zs-caller-app')).toBe('z-x_app');
  expect(headers.get('x-zs-contract-version')).toBe('1.0');
  expect(headers.get('x-app-correlation-reference')).toBe(
    'zx-output-auth:execution-1:attempt-1',
  );
  expect(headers.get('idempotency-key')).toBe(
    'zx-output-auth-idempotency:execution-1:attempt-1',
  );
  expect(headers.get('content-type')).toBe('application/json');
  expect(headers.get('accept')).toBe('application/json');
  expect(JSON.parse(String(request.init.body))).toEqual({
    executionId: 'execution-1',
    attemptId: 'attempt-1',
    contractVersion: 'zx.storage-output.v1',
    mode: 'post-run-ingest',
    artifactKind: 'image',
    acceptedMimeTypes: ['image/png'],
    mimeType: 'image/png',
    storageProfileRef: 'zs-profile:generated-image',
    maxBytes: 4096,
  });
});

test('authorization idempotency is stable for one attempt and isolated across attempts', async () => {
  const { client, requests } = createClient(() =>
    jsonResponse({
      authorizationRef: 'authorization-1',
      uploadRef: 'upload-1',
      expiresAt: futureExpiry(),
    }),
  );
  const signal = new AbortController().signal;

  await client.createOutputAuthorization(authorizationInput, signal);
  await client.createOutputAuthorization(authorizationInput, signal);
  await client.createOutputAuthorization(
    { ...authorizationInput, attemptId: 'attempt-2' },
    signal,
  );

  const keys = requests.map((request) => new Headers(request.init.headers).get('idempotency-key'));
  expect(keys[0]).toBe(keys[1]);
  expect(keys[2]).not.toBe(keys[0]);
});

test('completion sends execution and attempt identity without fixture fields', async () => {
  const { client, requests } = createClient(() => jsonResponse(imageResult()));
  await client.completeOrIngestOutput(completionInput, new AbortController().signal);

  const request = requests[0];
  if (!request) throw new Error('request was not captured');
  expect(request.url).toBe('https://z-s.example.test/v1/z-x/output-completions');
  expect(new Headers(request.init.headers).get('x-app-correlation-reference')).toBe(
    'zx-output-complete:execution-1:attempt-1',
  );
  expect(JSON.parse(String(request.init.body))).toEqual({
    executionId: 'execution-1',
    attemptId: 'attempt-1',
    authorizationRef: 'authorization-1',
    safeProviderOutputRef: 'provider-output-1',
    mimeType: 'image/png',
  });
  expect(String(request.init.body)).not.toContain('fixtureScenario');
});

test('reconciliation sends only persisted safe references and required identity', async () => {
  const { client, requests } = createClient(() =>
    jsonResponse({ status: 'completed', result: imageResult() }),
  );
  await client.reconcileOutput(reconciliationInput, new AbortController().signal);

  const request = requests[0];
  if (!request) throw new Error('request was not captured');
  expect(request.url).toBe('https://z-s.example.test/v1/z-x/output-reconciliations');
  expect(new Headers(request.init.headers).get('x-app-correlation-reference')).toBe(
    'zx-output-reconcile:execution-1:attempt-1',
  );
  expect(JSON.parse(String(request.init.body))).toEqual({
    executionId: 'execution-1',
    attemptId: 'attempt-1',
    authorizationRef: 'authorization-1',
    safeProviderOutputRef: 'provider-output-1',
    mimeType: 'image/png',
  });
  expect(String(request.init.body)).not.toContain('fixtureScenario');
});

test('authorization, completion, and reconciliation reject unknown fields', async () => {
  const authorization = createClient(() =>
    jsonResponse({
      authorizationRef: 'authorization-1',
      uploadRef: 'upload-1',
      expiresAt: futureExpiry(),
      extra: true,
    }),
  ).client;
  await expect(
    authorization.createOutputAuthorization(authorizationInput, new AbortController().signal),
  ).rejects.toMatchObject({ safe: { family: 'malformed-output', retryable: true } });

  const completion = createClient(() => jsonResponse({ ...imageResult(), extra: true })).client;
  await expect(
    completion.completeOrIngestOutput(completionInput, new AbortController().signal),
  ).rejects.toMatchObject({ safe: { family: 'malformed-output', retryable: true } });

  const reconciliation = createClient(() =>
    jsonResponse({ status: 'pending', retryAfterSeconds: 30, extra: true }),
  ).client;
  await expect(
    reconciliation.reconcileOutput(reconciliationInput, new AbortController().signal),
  ).rejects.toMatchObject({ safe: { family: 'malformed-output', retryable: true } });
});

test.each(prohibitedCases)('completion rejects %s leakage', async (_label, prohibited) => {
  const { client } = createClient(() => jsonResponse({ ...imageResult(), ...prohibited }));
  await expect(
    client.completeOrIngestOutput(completionInput, new AbortController().signal),
  ).rejects.toMatchObject({ safe: { code: 'ZX_Z_S_MALFORMED_RESPONSE' } });
});

test.each([0, 301, 1.5])(
  'reconciliation rejects an invalid pending interval of %s',
  async (retryAfterSeconds) => {
    const { client } = createClient(() =>
      jsonResponse({ status: 'pending', retryAfterSeconds }),
    );
    await expect(
      client.reconcileOutput(reconciliationInput, new AbortController().signal),
    ).rejects.toMatchObject({ safe: { family: 'malformed-output', retryable: true } });
  },
);
