import type {
  DelegatedOutputIntentV1,
  DelegatedOutputIntentResultV1,
  DelegatedOutputWriteV1,
  DelegatedStorageResultV1,
} from './z-s.js';
import {
  ZStorageHttpClient,
  type ZStorageHttpClientOptions,
} from './z-s-http.js';
import { SafeExecutionError, type SafeErrorV1 } from '../contracts/v1/error.js';

const DEFAULT_REQUEST_TIMEOUT_MS = 15_000;
const MAX_REQUEST_TIMEOUT_MS = 60_000;
const MAX_RESPONSE_BYTES = 128 * 1024;
const MIME_TYPE = /^[a-z0-9][a-z0-9.+-]*\/[a-z0-9][a-z0-9.+-]*$/i;
const SHA256 = /^[a-f0-9]{64}$/;
const SAFE_TECHNICAL_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,511}$/;
const FORBIDDEN_RESPONSE_KEYS = [
  'credential',
  'accesskey',
  'secretkey',
  'token',
  'signedurl',
  'providerurl',
  'endpoint',
  'bucket',
  'prefix',
  'objectkey',
  'localpath',
  'internallocator',
] as const;

type JsonRecord = Record<string, unknown>;

function hasNoForbiddenControlCharacters(value: string): boolean {
  return Array.from(value).every((character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint >= 32 && codePoint !== 127;
  });
}

function requiredString(value: unknown, label: string, maxLength = 4096): string {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > maxLength ||
    value.trim() !== value ||
    !hasNoForbiddenControlCharacters(value)
  ) {
    throw new Error(`${label} is invalid`);
  }
  return value;
}

function requiredTechnicalId(value: unknown, label: string): string {
  const parsed = requiredString(value, label, 512);
  if (!SAFE_TECHNICAL_ID.test(parsed)) throw new Error(`${label} is invalid`);
  return parsed;
}

function record(value: unknown, label: string): JsonRecord {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value as JsonRecord;
}

function normalizedKey(value: string): string {
  return value.replace(/[^a-z0-9]/gi, '').toLowerCase();
}

function rejectProviderPrivateFields(value: unknown, depth = 0): void {
  if (depth > 16) throw new Error('response nesting is too deep');
  if (Array.isArray(value)) {
    for (const item of value) rejectProviderPrivateFields(item, depth + 1);
    return;
  }
  if (typeof value !== 'object' || value === null) return;
  for (const [key, nested] of Object.entries(value as JsonRecord)) {
    const normalized = normalizedKey(key);
    if (
      FORBIDDEN_RESPONSE_KEYS.some(
        (forbidden) =>
          normalized === forbidden || normalized.startsWith(forbidden) || normalized.endsWith(forbidden),
      )
    ) {
      throw new Error('response contains a prohibited provider-private field');
    }
    rejectProviderPrivateFields(nested, depth + 1);
  }
}

function isJsonContentType(value: string | null): boolean {
  if (!value) return false;
  const mediaType = value.split(';', 1)[0]?.trim().toLowerCase();
  return mediaType === 'application/json' || Boolean(mediaType?.endsWith('+json'));
}

async function readBoundedJson(response: Response, signal: AbortSignal): Promise<JsonRecord> {
  if (!isJsonContentType(response.headers.get('content-type'))) {
    throw new Error('response content type is invalid');
  }
  const contentLength = response.headers.get('content-length');
  if (contentLength && /^\d+$/.test(contentLength) && Number(contentLength) > MAX_RESPONSE_BYTES) {
    throw new Error('response body is too large');
  }
  if (!response.body) throw new Error('response body is missing');

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      if (signal.aborted) throw signal.reason ?? new DOMException('Aborted', 'AbortError');
      const next = await reader.read();
      if (next.done) break;
      if (next.value === undefined) continue;
      total += next.value.byteLength;
      if (total > MAX_RESPONSE_BYTES) {
        await reader.cancel().catch(() => undefined);
        throw new Error('response body is too large');
      }
      chunks.push(next.value);
    }
  } finally {
    try {
      reader.releaseLock();
    } catch {
      // Cancellation may already have released the reader.
    }
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return record(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)), 'response body');
}

function safeFailure(
  family: SafeErrorV1['family'],
  code: string,
  message: string,
  retryable: boolean,
  traceId: string,
): SafeExecutionError {
  return new SafeExecutionError({ family, code, message, retryable, traceId });
}

function mapHttpFailure(status: number, traceId: string): SafeExecutionError {
  if (status === 401 || status === 403) {
    return safeFailure(
      'storage-output-failure',
      'ZX_Z_S_DELEGATED_WRITE_AUTH_REJECTED',
      'the delegated Z-s output authority was rejected',
      false,
      traceId,
    );
  }
  if (status === 404 || status === 410) {
    return safeFailure(
      'storage-output-failure',
      'ZX_Z_S_DELEGATED_WRITE_UNAVAILABLE',
      'the exact delegated Z-s write intent is unavailable',
      false,
      traceId,
    );
  }
  if (status === 409) {
    return safeFailure(
      'storage-output-failure',
      'ZX_Z_S_DELEGATED_WRITE_CONFLICT',
      'the exact delegated Z-s write conflicted',
      false,
      traceId,
    );
  }
  if (status === 400 || status === 413 || status === 415 || status === 422) {
    return safeFailure(
      'invalid-owner-request',
      'ZX_Z_S_DELEGATED_WRITE_REJECTED',
      'the delegated Z-s output request was invalid',
      false,
      traceId,
    );
  }
  if (status === 408 || status === 425 || status === 429 || status >= 500) {
    return safeFailure(
      'storage-output-failure',
      'ZX_Z_S_DELEGATED_WRITE_RETRYABLE_FAILURE',
      'the delegated Z-s output write failed retryably',
      true,
      traceId,
    );
  }
  return safeFailure(
    'storage-output-failure',
    'ZX_Z_S_DELEGATED_WRITE_FAILED',
    'the delegated Z-s output write failed safely',
    false,
    traceId,
  );
}

function positiveInteger(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${label} is invalid`);
  }
  return value;
}

function positiveNumber(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    throw new Error(`${label} is invalid`);
  }
  return value;
}

function parseDelegatedIntentResult(
  value: unknown,
): DelegatedOutputIntentResultV1 {
  const envelope = record(value, 'Z-s delegated write-intent response');
  const result = record(envelope.result, 'Z-s delegated write-intent result');
  const { uploadCompletionToken: rawUploadCompletionToken, ...safeResult } = result;
  rejectProviderPrivateFields({ ...envelope, result: safeResult });

  const writeIntentId = requiredTechnicalId(result.writeIntentId, 'writeIntentId');
  const storageObjectId = requiredTechnicalId(result.storageObjectId, 'storageObjectId');
  const uploadCompletionToken = requiredString(
    rawUploadCompletionToken,
    'uploadCompletionToken',
    4096,
  );
  const expiresAt = requiredString(result.expiresAt, 'expiresAt', 64);
  if (!Number.isFinite(Date.parse(expiresAt))) throw new Error('expiresAt is invalid');
  const state = requiredString(result.state, 'state', 32);
  if (state !== 'accepted' && state !== 'recorded') {
    throw new Error('write-intent state is invalid');
  }

  return Object.freeze({
    writeIntentId,
    storageObjectId,
    uploadCompletionToken,
    expiresAt,
  });
}

function parseDelegatedResult(
  value: unknown,
  input: DelegatedOutputWriteV1,
  traceId: string,
): DelegatedStorageResultV1 {
  rejectProviderPrivateFields(value);
  const envelope = record(value, 'Z-s delegated output response');
  const result = record(envelope.result, 'Z-s delegated output result');
  const writeIntentId = requiredTechnicalId(result.writeIntentId, 'writeIntentId');
  if (writeIntentId !== input.writeIntentId) {
    throw new Error('Z-s response write intent identity changed');
  }
  const state = requiredString(result.state, 'state', 32);
  if (state === 'recorded') {
    throw safeFailure(
      'storage-output-failure',
      'ZX_Z_S_DELEGATED_WRITE_PENDING',
      'the delegated Z-s output write is recorded but not yet verified',
      true,
      traceId,
    );
  }
  if (state !== 'verified') {
    throw safeFailure(
      'storage-output-failure',
      'ZX_Z_S_DELEGATED_WRITE_REJECTED',
      'the delegated Z-s output write was not verified',
      false,
      traceId,
    );
  }

  const storageObjectId = requiredTechnicalId(result.storageObjectId, 'storageObjectId');
  const checksumSha256 = requiredString(result.checksumSha256, 'checksumSha256', 64);
  if (!SHA256.test(checksumSha256) || checksumSha256 !== input.artifact.checksumSha256) {
    throw new Error('Z-s response checksum does not match the captured artifact');
  }
  const sizeBytes = positiveInteger(result.byteLength, 'byteLength');
  if (sizeBytes !== input.artifact.sizeBytes) {
    throw new Error('Z-s response byte length does not match the captured artifact');
  }
  const objectProtectionStage = requiredString(
    result.objectProtectionStage,
    'objectProtectionStage',
    128,
  );
  const storageStateValue = result.storageState;
  const storageState =
    storageStateValue === undefined
      ? undefined
      : requiredString(storageStateValue, 'storageState', 32);
  if (
    storageState !== undefined &&
    storageState !== 'ready' &&
    storageState !== 'degraded' &&
    storageState !== 'unavailable'
  ) {
    throw new Error('storageState is invalid');
  }
  if (storageState === 'unavailable') {
    throw safeFailure(
      'storage-output-failure',
      'ZX_Z_S_DELEGATED_WRITE_UNAVAILABLE',
      'the delegated Z-s object is unavailable after upload',
      true,
      traceId,
    );
  }

  let width: number | undefined;
  let height: number | undefined;
  let durationSeconds: number | undefined;
  if (result.verifiedMedia !== undefined) {
    const verifiedMedia = record(result.verifiedMedia, 'verifiedMedia');
    const mediaType = requiredString(verifiedMedia.mediaType, 'verifiedMedia.mediaType', 160);
    if (mediaType !== input.artifact.mimeType) throw new Error('verified media MIME changed');
    if (verifiedMedia.image !== undefined) {
      const image = record(verifiedMedia.image, 'verifiedMedia.image');
      width = positiveInteger(image.width, 'verifiedMedia.image.width');
      height = positiveInteger(image.height, 'verifiedMedia.image.height');
    }
    if (verifiedMedia.video !== undefined) {
      const video = record(verifiedMedia.video, 'verifiedMedia.video');
      if (video.width !== undefined) width = positiveInteger(video.width, 'verifiedMedia.video.width');
      if (video.height !== undefined) height = positiveInteger(video.height, 'verifiedMedia.video.height');
      durationSeconds = positiveNumber(video.durationMs, 'verifiedMedia.video.durationMs') / 1000;
    }
  }

  return Object.freeze({
    storageObjectId,
    writeIntentId,
    checksumSha256,
    mimeType: input.artifact.mimeType,
    sizeBytes,
    ...(width === undefined ? {} : { width }),
    ...(height === undefined ? {} : { height }),
    ...(durationSeconds === undefined ? {} : { durationSeconds }),
    objectProtectionStage,
    ...(storageState === undefined
      ? {}
      : { storageState: storageState as 'ready' | 'degraded' | 'unavailable' }),
  });
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

function authority(value: string): string {
  return requiredString(value, 'delegated write authority', 4096);
}

function operationReference(input: Readonly<{ executionId: string; attemptId: string }>): string {
  const executionId = requiredTechnicalId(input.executionId, 'executionId');
  const attemptId = requiredTechnicalId(input.attemptId, 'attemptId');
  const reference = `zx-output-write:${executionId}:${attemptId}`;
  if (reference.length > 120) throw new Error('delegated output correlation is too long');
  return reference;
}

export class ZStorageDelegatedOutputHttpClient extends ZStorageHttpClient {
  readonly #baseUrl: string;
  readonly #bearerToken: string;
  readonly #fetchImpl: typeof fetch;
  readonly #requestTimeoutMs: number;

  constructor(options: ZStorageHttpClientOptions) {
    super(options);
    this.#baseUrl = normalizeBaseUrl(options.baseUrl);
    if (!options.bearerToken.trim()) throw new Error('Z-s bearer token is required');
    this.#bearerToken = options.bearerToken;
    this.#fetchImpl = options.fetchImpl ?? fetch;
    this.#requestTimeoutMs = options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
    if (
      !Number.isSafeInteger(this.#requestTimeoutMs) ||
      this.#requestTimeoutMs < 1 ||
      this.#requestTimeoutMs > MAX_REQUEST_TIMEOUT_MS
    ) {
      throw new Error('Z-s request timeout is invalid');
    }
  }

  async createDelegatedOutputWriteIntent(
    input: DelegatedOutputIntentV1,
    callerSignal: AbortSignal,
  ): Promise<DelegatedOutputIntentResultV1> {
    const writeAuthorizationRef = authority(input.writeAuthorizationRef);
    const mimeType = requiredString(input.artifact.mimeType, 'artifact mimeType', 160);
    if (!MIME_TYPE.test(mimeType)) throw new Error('artifact mimeType is invalid');
    if (!SHA256.test(input.artifact.checksumSha256)) throw new Error('artifact checksum is invalid');
    if (!Number.isSafeInteger(input.artifact.sizeBytes) || input.artifact.sizeBytes <= 0) {
      throw new Error('artifact size is invalid');
    }
    requiredString(input.artifact.artifactRef, 'artifactRef', 512);
    const correlation = operationReference(input);
    const timeoutController = new AbortController();
    const requestSignal = AbortSignal.any([callerSignal, timeoutController.signal]);
    const timeout = setTimeout(() => timeoutController.abort(), this.#requestTimeoutMs);

    try {
      let response: Response;
      try {
        response = await this.#fetchImpl(
          `${this.#baseUrl}/v1/object-write-intents`,
          {
            method: 'POST',
            redirect: 'error',
            credentials: 'omit',
            headers: {
              authorization: `Bearer ${this.#bearerToken}`,
              'x-zs-write-authorization-token': writeAuthorizationRef,
              'x-zs-caller-app': 'z-x_app',
              'x-zs-contract-version': '1.0',
              'x-app-correlation-reference': correlation,
              'idempotency-key': `${correlation}:intent`,
              'content-type': 'application/json',
              accept: 'application/json',
            },
            body: JSON.stringify({
              mediaType: mimeType,
              byteLength: input.artifact.sizeBytes,
              checksumSha256: input.artifact.checksumSha256,
            }),
            signal: requestSignal,
          },
        );
      } catch (error) {
        if (callerSignal.aborted) throw callerSignal.reason ?? error;
        if (timeoutController.signal.aborted) {
          throw safeFailure(
            'timeout',
            'ZX_Z_S_DELEGATED_INTENT_TIMEOUT',
            'the delegated Z-s write-intent request timed out',
            true,
            correlation,
          );
        }
        if (error instanceof SafeExecutionError) throw error;
        throw safeFailure(
          'storage-output-failure',
          'ZX_Z_S_DELEGATED_INTENT_REQUEST_FAILED',
          'the delegated Z-s write-intent request failed safely',
          true,
          correlation,
        );
      }

      if (!response.ok) throw mapHttpFailure(response.status, correlation);
      if (response.status !== 200) {
        throw safeFailure(
          'storage-output-failure',
          'ZX_Z_S_DELEGATED_INTENT_RESPONSE_INVALID',
          'the delegated Z-s write-intent response was invalid',
          true,
          correlation,
        );
      }
      try {
        return parseDelegatedIntentResult(await readBoundedJson(response, requestSignal));
      } catch (error) {
        if (error instanceof SafeExecutionError) throw error;
        throw safeFailure(
          'malformed-output',
          'ZX_Z_S_DELEGATED_INTENT_MALFORMED_RESPONSE',
          'the delegated Z-s write-intent response was malformed',
          true,
          correlation,
        );
      }
    } finally {
      clearTimeout(timeout);
    }
  }

  async writeDelegatedOutput(
    input: DelegatedOutputWriteV1,
    callerSignal: AbortSignal,
  ): Promise<DelegatedStorageResultV1> {
    const writeIntentId = requiredTechnicalId(input.writeIntentId, 'writeIntentId');
    const writeAuthorityRef = authority(input.writeAuthorityRef);
    const mimeType = requiredString(input.artifact.mimeType, 'artifact mimeType', 160);
    if (!MIME_TYPE.test(mimeType)) throw new Error('artifact mimeType is invalid');
    if (!SHA256.test(input.artifact.checksumSha256)) throw new Error('artifact checksum is invalid');
    if (!Number.isSafeInteger(input.artifact.sizeBytes) || input.artifact.sizeBytes <= 0) {
      throw new Error('artifact size is invalid');
    }
    const correlation = operationReference(input);
    const timeoutController = new AbortController();
    const requestSignal = AbortSignal.any([callerSignal, timeoutController.signal]);
    const timeout = setTimeout(() => timeoutController.abort(), this.#requestTimeoutMs);

    try {
      let response: Response;
      try {
        const init: RequestInit & { duplex: 'half' } = {
          method: 'PUT',
          redirect: 'error',
          credentials: 'omit',
          duplex: 'half',
          headers: {
            authorization: `Bearer ${this.#bearerToken}`,
            'x-zs-upload-completion-token': writeAuthorityRef,
            'x-zs-caller-app': 'z-x_app',
            'x-zs-contract-version': '1.0',
            'x-app-correlation-reference': correlation,
            'idempotency-key': `${correlation}:content`,
            'content-type': mimeType,
            'content-length': String(input.artifact.sizeBytes),
            'x-content-sha256': input.artifact.checksumSha256,
            accept: 'application/json',
          },
          body: input.artifact.body,
          signal: requestSignal,
        };
        response = await this.#fetchImpl(
          `${this.#baseUrl}/v1/object-write-intents/${encodeURIComponent(writeIntentId)}/content`,
          init,
        );
      } catch (error) {
        if (callerSignal.aborted) throw callerSignal.reason ?? error;
        if (timeoutController.signal.aborted) {
          throw safeFailure(
            'timeout',
            'ZX_Z_S_DELEGATED_WRITE_TIMEOUT',
            'the delegated Z-s output write timed out',
            true,
            correlation,
          );
        }
        if (error instanceof SafeExecutionError) throw error;
        throw safeFailure(
          'storage-output-failure',
          'ZX_Z_S_DELEGATED_WRITE_REQUEST_FAILED',
          'the delegated Z-s output write failed safely',
          true,
          correlation,
        );
      }

      if (!response.ok) throw mapHttpFailure(response.status, correlation);
      if (response.status !== 200) {
        throw safeFailure(
          'storage-output-failure',
          'ZX_Z_S_DELEGATED_WRITE_RESPONSE_INVALID',
          'the delegated Z-s output response was invalid',
          true,
          correlation,
        );
      }
      try {
        return parseDelegatedResult(await readBoundedJson(response, requestSignal), input, correlation);
      } catch (error) {
        if (error instanceof SafeExecutionError) throw error;
        throw safeFailure(
          'malformed-output',
          'ZX_Z_S_DELEGATED_WRITE_MALFORMED_RESPONSE',
          'the delegated Z-s output response was malformed',
          true,
          correlation,
        );
      }
    } finally {
      clearTimeout(timeout);
    }
  }
}
