import type {
  ExactObjectReadInputV1,
  ExactObjectReadResultV1,
} from './z-s.js';
import {
  ZStorageHttpClient,
  type ZStorageHttpClientOptions,
} from './z-s-http.js';
import { SafeExecutionError } from '../contracts/v1/error.js';

const DEFAULT_REQUEST_TIMEOUT_MS = 15_000;
const MAX_REQUEST_TIMEOUT_MS = 60_000;
const CHECKSUM_ETAG = /^"([a-f0-9]{64})"$/;
const MIME_TYPE = /^[a-z0-9][a-z0-9.+-]*\/[a-z0-9][a-z0-9.+-]*$/i;

function hasForbiddenControlCharacters(value: string): boolean {
  return Array.from(value).some((character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint < 32 || codePoint === 127;
  });
}

function requiredHeaderString(value: string | null, label: string, maxLength: number): string {
  if (
    value === null ||
    value.length === 0 ||
    value.length > maxLength ||
    value.trim() !== value ||
    hasForbiddenControlCharacters(value)
  ) {
    throw new Error(`${label} is invalid`);
  }
  return value;
}

function exactStorageObjectPath(storageObjectId: string): string {
  if (
    typeof storageObjectId !== 'string' ||
    storageObjectId.length === 0 ||
    storageObjectId.length > 512 ||
    storageObjectId.trim() !== storageObjectId ||
    hasForbiddenControlCharacters(storageObjectId)
  ) {
    throw new SafeExecutionError({
      family: 'invalid-owner-request',
      code: 'ZX_Z_S_INPUT_OBJECT_ID_INVALID',
      message: 'the exact Z-s input object identity is invalid',
      retryable: false,
      traceId: 'zx-z-s-input-read',
    });
  }
  return `/v1/storage-objects/${encodeURIComponent(storageObjectId)}/content`;
}

function readAuthority(value: string): string {
  if (
    typeof value !== 'string' ||
    value.length < 1 ||
    value.length > 4096 ||
    value.trim() !== value ||
    hasForbiddenControlCharacters(value)
  ) {
    throw new SafeExecutionError({
      family: 'invalid-owner-request',
      code: 'ZX_Z_S_INPUT_AUTHORITY_INVALID',
      message: 'the delegated Z-s input authority is invalid',
      retryable: false,
      traceId: 'zx-z-s-input-read',
    });
  }
  return value;
}

function normalizeBaseUrl(value: string): string {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error('Z-s base URL is invalid');
  }
  if (
    (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') ||
    parsed.username ||
    parsed.password ||
    parsed.search ||
    parsed.hash
  ) {
    throw new Error('Z-s base URL is invalid');
  }
  return parsed.toString().replace(/\/+$/, '');
}

function correlationReference(input: ExactObjectReadInputV1): string {
  const executionId = encodeURIComponent(input.executionId.slice(0, 512));
  const attemptId = encodeURIComponent(input.attemptId.slice(0, 512));
  return `zx-input-read:${executionId}:${attemptId}`;
}

function safeFailure(
  code: string,
  message: string,
  retryable: boolean,
  traceId: string,
  family: 'storage-input-failure' | 'timeout' = 'storage-input-failure',
): SafeExecutionError {
  return new SafeExecutionError({ family, code, message, retryable, traceId });
}

function mapHttpFailure(status: number, traceId: string): SafeExecutionError {
  if (status === 401 || status === 403) {
    return safeFailure(
      'ZX_Z_S_INPUT_AUTH_REJECTED',
      'the delegated Z-s input authority was rejected',
      false,
      traceId,
    );
  }
  if (status === 404) {
    return safeFailure(
      'ZX_Z_S_INPUT_NOT_FOUND',
      'the exact Z-s input object was not found',
      false,
      traceId,
    );
  }
  if (status === 409) {
    return safeFailure(
      'ZX_Z_S_INPUT_NOT_READY',
      'the exact Z-s input object is not ready',
      true,
      traceId,
    );
  }
  if (status === 410) {
    return safeFailure(
      'ZX_Z_S_INPUT_UNAVAILABLE',
      'the exact Z-s input object is unavailable',
      false,
      traceId,
    );
  }
  if (status === 408 || status === 425 || status === 429 || status >= 500) {
    return safeFailure(
      'ZX_Z_S_INPUT_READ_RETRYABLE_FAILURE',
      'the exact Z-s input read failed retryably',
      true,
      traceId,
    );
  }
  return safeFailure(
    'ZX_Z_S_INPUT_READ_REJECTED',
    'the exact Z-s input read was rejected',
    false,
    traceId,
  );
}

function parseContentLength(value: string | null): number {
  const parsed = requiredHeaderString(value, 'content-length', 32);
  if (!/^\d+$/.test(parsed)) throw new Error('content-length is invalid');
  const sizeBytes = Number(parsed);
  if (!Number.isSafeInteger(sizeBytes) || sizeBytes <= 0) {
    throw new Error('content-length is invalid');
  }
  return sizeBytes;
}

function verifiedBody(
  source: ReadableStream<Uint8Array>,
  expectedBytes: number,
  signal: AbortSignal,
  traceId: string,
): ReadableStream<Uint8Array> {
  const reader = source.getReader();
  let observedBytes = 0;
  let released = false;

  const release = (): void => {
    if (released) return;
    released = true;
    try {
      reader.releaseLock();
    } catch {
      // The stream may already have released the lock during cancellation.
    }
  };

  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (signal.aborted) {
        await reader.cancel(signal.reason).catch(() => undefined);
        release();
        controller.error(signal.reason ?? new DOMException('Aborted', 'AbortError'));
        return;
      }
      try {
        const chunk = await reader.read();
        if (chunk.done) {
          release();
          if (observedBytes !== expectedBytes) {
            controller.error(
              safeFailure(
                'ZX_Z_S_INPUT_LENGTH_MISMATCH',
                'the exact Z-s input stream length did not match verified metadata',
                true,
                traceId,
              ),
            );
            return;
          }
          controller.close();
          return;
        }
        if (chunk.value !== undefined) {
          observedBytes += chunk.value.byteLength;
          if (observedBytes > expectedBytes) {
            await reader.cancel().catch(() => undefined);
            release();
            controller.error(
              safeFailure(
                'ZX_Z_S_INPUT_LENGTH_MISMATCH',
                'the exact Z-s input stream exceeded verified metadata',
                true,
                traceId,
              ),
            );
            return;
          }
          controller.enqueue(chunk.value);
        }
      } catch (error) {
        release();
        controller.error(error);
      }
    },
    async cancel(reason) {
      await reader.cancel(reason).catch(() => undefined);
      release();
    },
  });
}

export class ZStorageExactObjectHttpClient extends ZStorageHttpClient {
  private readonly exactObjectBaseUrl: string;
  private readonly exactObjectBearerToken: string;
  private readonly exactObjectFetch: typeof fetch;
  private readonly exactObjectRequestTimeoutMs: number;

  constructor(options: ZStorageHttpClientOptions) {
    super(options);
    this.exactObjectBaseUrl = normalizeBaseUrl(options.baseUrl);
    if (!options.bearerToken.trim()) throw new Error('Z-s bearer token is required');
    const requestTimeoutMs = options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
    if (
      !Number.isSafeInteger(requestTimeoutMs) ||
      requestTimeoutMs < 1 ||
      requestTimeoutMs > MAX_REQUEST_TIMEOUT_MS
    ) {
      throw new Error('Z-s request timeout is invalid');
    }
    this.exactObjectBearerToken = options.bearerToken;
    this.exactObjectFetch = options.fetchImpl ?? fetch;
    this.exactObjectRequestTimeoutMs = requestTimeoutMs;
  }

  async readExactObject(
    input: ExactObjectReadInputV1,
    callerSignal: AbortSignal,
  ): Promise<ExactObjectReadResultV1> {
    const path = exactStorageObjectPath(input.storageObjectId);
    const authority = readAuthority(input.readAuthorityRef);
    const correlation = correlationReference(input);
    const timeoutController = new AbortController();
    const requestSignal = AbortSignal.any([callerSignal, timeoutController.signal]);
    const timeout = setTimeout(() => timeoutController.abort(), this.exactObjectRequestTimeoutMs);

    let response: Response;
    try {
      try {
        response = await this.exactObjectFetch(`${this.exactObjectBaseUrl}${path}`, {
          method: 'GET',
          redirect: 'error',
          credentials: 'omit',
          headers: {
            authorization: `Bearer ${this.exactObjectBearerToken}`,
            'x-zs-read-grant-token': authority,
            'x-zs-caller-app': 'z-x_app',
            'x-zs-contract-version': '1.0',
            'x-app-correlation-reference': correlation,
            accept: '*/*',
          },
          signal: requestSignal,
        });
      } catch (error) {
        if (callerSignal.aborted) throw callerSignal.reason ?? error;
        if (timeoutController.signal.aborted) {
          throw safeFailure(
            'ZX_Z_S_INPUT_READ_TIMEOUT',
            'the exact Z-s input read timed out',
            true,
            correlation,
            'timeout',
          );
        }
        throw safeFailure(
          'ZX_Z_S_INPUT_READ_FAILED',
          'the exact Z-s input read failed safely',
          true,
          correlation,
        );
      }

      if (!response.ok) throw mapHttpFailure(response.status, correlation);
      if (response.status !== 200) {
        throw safeFailure(
          'ZX_Z_S_INPUT_RESPONSE_INVALID',
          'the exact Z-s input response was invalid',
          true,
          correlation,
        );
      }
      if (response.headers.has('location') || response.headers.has('content-location')) {
        throw safeFailure(
          'ZX_Z_S_INPUT_RESPONSE_INVALID',
          'the exact Z-s input response exposed an unsupported location',
          false,
          correlation,
        );
      }

      let mimeType: string;
      let sizeBytes: number;
      let checksumSha256: string;
      try {
        mimeType = requiredHeaderString(response.headers.get('content-type'), 'content-type', 128);
        if (!MIME_TYPE.test(mimeType)) throw new Error('content-type is invalid');
        sizeBytes = parseContentLength(response.headers.get('content-length'));
        const etag = requiredHeaderString(response.headers.get('etag'), 'etag', 80);
        const checksumMatch = CHECKSUM_ETAG.exec(etag);
        if (checksumMatch?.[1] === undefined) throw new Error('etag is invalid');
        checksumSha256 = checksumMatch[1];
      } catch {
        throw safeFailure(
          'ZX_Z_S_INPUT_RESPONSE_INVALID',
          'the exact Z-s input response metadata was invalid',
          true,
          correlation,
        );
      }
      if (response.body === null) {
        throw safeFailure(
          'ZX_Z_S_INPUT_RESPONSE_INVALID',
          'the exact Z-s input response body was missing',
          true,
          correlation,
        );
      }

      return {
        storageObjectId: input.storageObjectId,
        mimeType,
        sizeBytes,
        checksumSha256,
        body: verifiedBody(response.body, sizeBytes, callerSignal, correlation),
      };
    } finally {
      clearTimeout(timeout);
    }
  }
}
