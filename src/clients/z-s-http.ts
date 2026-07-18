import type { ZStorageClient } from './z-s.js';
import type {
  CompleteOutputV1,
  CreateOutputAuthorizationV1,
  CreateReadGrantV1,
  OutputAuthorizationV1,
  OutputReconciliationV1,
  ReadGrantV1,
  ReconcileOutputV1,
  StorageResultV1,
} from '../contracts/v1/dependencies.js';
import { SafeExecutionError, type SafeErrorV1 } from '../contracts/v1/error.js';
import { validateGeneratedMedia } from '../validation/output.js';

const MAX_RESPONSE_BYTES = 64 * 1024;
const DEFAULT_REQUEST_TIMEOUT_MS = 15_000;
const MAX_REQUEST_TIMEOUT_MS = 60_000;
const CLOCK_SKEW_MS = 5 * 60 * 1000;
const SAFE_CODE = /^[A-Z][A-Z0-9_]{0,127}$/;
const IMAGE_MIME_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp']);
const VIDEO_MIME_TYPES = new Set(['video/mp4', 'video/webm']);
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

const ROUTES = {
  authorization: '/v1/z-x/output-authorizations',
  completion: '/v1/z-x/output-completions',
  reconciliation: '/v1/z-x/output-reconciliations',
} as const;

type Operation = keyof typeof ROUTES;
type JsonRecord = Record<string, unknown>;

export interface ZStorageHttpClientOptions {
  baseUrl: string;
  bearerToken: string;
  fetchImpl?: typeof fetch;
  requestTimeoutMs?: number;
}

function record(value: unknown, label: string): JsonRecord {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value as JsonRecord;
}

function exactKeys(value: JsonRecord, allowed: readonly string[], label: string): void {
  const permitted = new Set(allowed);
  for (const key of Object.keys(value)) {
    if (!permitted.has(key)) throw new Error(`${label} contains an unknown field`);
  }
}

function normalizedKey(value: string): string {
  return value.replace(/[^a-z0-9]/gi, '').toLowerCase();
}

function rejectForbiddenResponseFields(value: unknown, depth = 0): void {
  if (depth > 16) throw new Error('response nesting is too deep');
  if (Array.isArray(value)) {
    for (const item of value) rejectForbiddenResponseFields(item, depth + 1);
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
      throw new Error('response contains a prohibited field');
    }
    rejectForbiddenResponseFields(nested, depth + 1);
  }
}

function requiredString(value: unknown, label: string, maximumLength = 4096): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > maximumLength) {
    throw new Error(`${label} is invalid`);
  }
  if (value.trim() !== value || /[\u0000-\u001f\u007f]/.test(value)) {
    throw new Error(`${label} is invalid`);
  }
  return value;
}

function requiredOpaqueReference(value: unknown, label: string): string {
  const parsed = requiredString(value, label, 512);
  if (
    /^[a-z][a-z0-9+.-]*:\/\//i.test(parsed) ||
    parsed.includes('/') ||
    parsed.includes('\\') ||
    /^[a-z]:[\\/]/i.test(parsed)
  ) {
    throw new Error(`${label} must be an opaque reference`);
  }
  return parsed;
}

function requiredPositiveSafeInteger(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${label} must be a positive safe integer`);
  }
  return value;
}

function requiredPositiveNumber(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    throw new Error(`${label} must be positive`);
  }
  return value;
}

function requiredFutureTimestamp(value: unknown): string {
  const parsed = requiredString(value, 'authorization expiresAt', 128);
  const timestamp = Date.parse(parsed);
  if (!Number.isFinite(timestamp) || new Date(timestamp).toISOString() !== parsed) {
    throw new Error('authorization expiresAt is invalid');
  }
  if (timestamp <= Date.now() - CLOCK_SKEW_MS) {
    throw new Error('authorization expiresAt is not future-looking');
  }
  return parsed;
}

function parseAuthorization(value: unknown): OutputAuthorizationV1 {
  rejectForbiddenResponseFields(value);
  const input = record(value, 'authorization response');
  exactKeys(input, ['authorizationRef', 'uploadRef', 'expiresAt'], 'authorization response');
  return {
    authorizationRef: requiredOpaqueReference(input.authorizationRef, 'authorizationRef'),
    uploadRef: requiredOpaqueReference(input.uploadRef, 'uploadRef'),
    expiresAt: requiredFutureTimestamp(input.expiresAt),
  };
}

function parseStorageResult(value: unknown, expectedMimeType: string): StorageResultV1 {
  rejectForbiddenResponseFields(value);
  const input = record(value, 'storage result');
  exactKeys(
    input,
    [
      'resourceId',
      'resourceVersionId',
      'storageIdentity',
      'checksumSha256',
      'mimeType',
      'sizeBytes',
      'width',
      'height',
      'durationSeconds',
    ],
    'storage result',
  );

  const mimeType = requiredString(input.mimeType, 'storage result mimeType', 128);
  if (mimeType !== expectedMimeType) throw new Error('storage result MIME does not match the request');
  const kind = IMAGE_MIME_TYPES.has(mimeType)
    ? 'image'
    : VIDEO_MIME_TYPES.has(mimeType)
      ? 'video'
      : undefined;
  if (!kind) throw new Error('storage result MIME is unsupported');

  const checksumSha256 = requiredString(input.checksumSha256, 'storage result checksumSha256', 64);
  if (!/^[a-f0-9]{64}$/.test(checksumSha256)) {
    throw new Error('storage result checksumSha256 is invalid');
  }
  const storageIdentity = requiredString(input.storageIdentity, 'storage result storageIdentity', 1024);
  if (!/^zs:\/\/[A-Za-z0-9._~:/-]+$/.test(storageIdentity)) {
    throw new Error('storage result storageIdentity is not provider-neutral');
  }

  const sizeBytes = requiredPositiveSafeInteger(input.sizeBytes, 'storage result sizeBytes');
  const width = requiredPositiveSafeInteger(input.width, 'storage result width');
  const height = requiredPositiveSafeInteger(input.height, 'storage result height');
  const durationSeconds =
    input.durationSeconds === undefined
      ? undefined
      : requiredPositiveNumber(input.durationSeconds, 'storage result durationSeconds');
  if (kind === 'video' && durationSeconds === undefined) {
    throw new Error('storage result durationSeconds is required for video');
  }
  if (kind === 'image' && durationSeconds !== undefined) {
    throw new Error('storage result durationSeconds is invalid for image');
  }

  validateGeneratedMedia(kind, {
    mimeType,
    sizeBytes,
    width,
    height,
    checksumSha256,
    storageIdentity,
    ...(durationSeconds === undefined ? {} : { durationSeconds }),
  });

  return {
    resourceId: requiredOpaqueReference(input.resourceId, 'storage result resourceId'),
    resourceVersionId: requiredOpaqueReference(
      input.resourceVersionId,
      'storage result resourceVersionId',
    ),
    storageIdentity,
    checksumSha256,
    mimeType,
    sizeBytes,
    width,
    height,
    ...(durationSeconds === undefined ? {} : { durationSeconds }),
  };
}

function parseReconciliation(value: unknown, expectedMimeType: string): OutputReconciliationV1 {
  rejectForbiddenResponseFields(value);
  const input = record(value, 'storage reconciliation response');
  const status = requiredString(input.status, 'storage reconciliation status', 32);
  if (status === 'completed') {
    exactKeys(input, ['status', 'result'], 'storage reconciliation completed response');
    return { status, result: parseStorageResult(input.result, expectedMimeType) };
  }
  if (status === 'pending') {
    exactKeys(input, ['status', 'retryAfterSeconds'], 'storage reconciliation pending response');
    const retryAfterSeconds = input.retryAfterSeconds;
    if (
      typeof retryAfterSeconds !== 'number' ||
      !Number.isInteger(retryAfterSeconds) ||
      retryAfterSeconds < 1 ||
      retryAfterSeconds > 300
    ) {
      throw new Error('storage reconciliation retryAfterSeconds is invalid');
    }
    return { status, retryAfterSeconds };
  }
  if (status === 'failed') {
    exactKeys(input, ['status', 'errorCode', 'retryable'], 'storage reconciliation failed response');
    const errorCode = requiredString(input.errorCode, 'storage reconciliation errorCode', 128);
    if (!SAFE_CODE.test(errorCode) || typeof input.retryable !== 'boolean') {
      throw new Error('storage reconciliation failure is invalid');
    }
    return { status, errorCode, retryable: input.retryable };
  }
  throw new Error('storage reconciliation status is invalid');
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
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > MAX_RESPONSE_BYTES) {
        await reader.cancel().catch(() => undefined);
        throw new Error('response body is too large');
      }
      chunks.push(value);
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
  const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  const parsed: unknown = JSON.parse(text);
  return record(parsed, 'response body');
}

interface UpstreamErrorHint {
  rawCode?: string;
  safeCode?: string;
  retryable?: boolean;
}

function boundedUpstreamCode(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.length === 0 || value.length > 128) return undefined;
  if (/[\u0000-\u001f\u007f]/.test(value)) return undefined;
  return value;
}

function extractUpstreamErrorHint(value: JsonRecord): UpstreamErrorHint {
  const nested =
    typeof value.error === 'object' && value.error !== null && !Array.isArray(value.error)
      ? (value.error as JsonRecord)
      : undefined;
  const rawCode = boundedUpstreamCode(value.code) ?? boundedUpstreamCode(nested?.code);
  const retryable =
    typeof value.retryable === 'boolean'
      ? value.retryable
      : typeof nested?.retryable === 'boolean'
        ? nested.retryable
        : undefined;
  return {
    ...(rawCode === undefined ? {} : { rawCode }),
    ...(rawCode !== undefined && SAFE_CODE.test(rawCode) ? { safeCode: rawCode } : {}),
    ...(retryable === undefined ? {} : { retryable }),
  };
}

async function readUpstreamErrorHint(
  response: Response,
  signal: AbortSignal,
): Promise<UpstreamErrorHint> {
  if (!isJsonContentType(response.headers.get('content-type'))) return {};
  try {
    return extractUpstreamErrorHint(await readBoundedJson(response, signal));
  } catch (error) {
    if (signal.aborted) throw signal.reason ?? error;
    return {};
  }
}

function isExplicitNotReady(code: string | undefined): boolean {
  if (!code) return false;
  return code.toUpperCase().replace(/[.-]/g, '_').includes('NOT_READY');
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

function stableHeaderComponent(value: string): string {
  const parsed = requiredString(value, 'execution identity', 512);
  return encodeURIComponent(parsed);
}

function operationReferences(
  operation: Operation,
  executionId: string,
  attemptId: string,
): { correlation: string; idempotencyKey: string } {
  const execution = stableHeaderComponent(executionId);
  const attempt = stableHeaderComponent(attemptId);
  const prefix =
    operation === 'authorization'
      ? 'zx-output-auth'
      : operation === 'completion'
        ? 'zx-output-complete'
        : 'zx-output-reconcile';
  return {
    correlation: `${prefix}:${execution}:${attempt}`,
    idempotencyKey: `${prefix}-idempotency:${execution}:${attempt}`,
  };
}

export class ZStorageHttpClient implements ZStorageClient {
  private readonly baseUrl: string;
  private readonly bearerToken: string;
  private readonly fetchImpl: typeof fetch;
  private readonly requestTimeoutMs: number;

  constructor(options: ZStorageHttpClientOptions) {
    this.baseUrl = normalizeBaseUrl(options.baseUrl);
    if (!options.bearerToken.trim()) throw new Error('Z-s bearer token is required');
    const requestTimeoutMs = options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
    if (!Number.isSafeInteger(requestTimeoutMs) || requestTimeoutMs < 1 || requestTimeoutMs > MAX_REQUEST_TIMEOUT_MS) {
      throw new Error('Z-s request timeout is invalid');
    }
    this.bearerToken = options.bearerToken;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.requestTimeoutMs = requestTimeoutMs;
  }

  async createOutputAuthorization(
    input: CreateOutputAuthorizationV1,
    signal: AbortSignal,
  ): Promise<OutputAuthorizationV1> {
    return this.post(
      'authorization',
      input.executionId,
      input.attemptId,
      {
        executionId: input.executionId,
        attemptId: input.attemptId,
        contractVersion: 'zx.storage-output.v1',
        mode: input.mode,
        artifactKind: input.artifactKind,
        acceptedMimeTypes: [...input.acceptedMimeTypes],
        mimeType: input.mimeType,
        ...(input.storageProfileRef === undefined
          ? {}
          : { storageProfileRef: input.storageProfileRef }),
        ...(input.maxBytes === undefined ? {} : { maxBytes: input.maxBytes }),
      },
      signal,
      parseAuthorization,
    );
  }

  async completeOrIngestOutput(
    input: CompleteOutputV1,
    signal: AbortSignal,
  ): Promise<StorageResultV1> {
    return this.post(
      'completion',
      input.executionId,
      input.attemptId,
      {
        executionId: input.executionId,
        attemptId: input.attemptId,
        authorizationRef: input.authorizationRef,
        safeProviderOutputRef: input.safeProviderOutputRef,
        mimeType: input.mimeType,
      },
      signal,
      (value) => parseStorageResult(value, input.mimeType),
    );
  }

  async reconcileOutput(
    input: ReconcileOutputV1,
    signal: AbortSignal,
  ): Promise<OutputReconciliationV1> {
    return this.post(
      'reconciliation',
      input.executionId,
      input.attemptId,
      {
        executionId: input.executionId,
        attemptId: input.attemptId,
        authorizationRef: input.authorizationRef,
        safeProviderOutputRef: input.safeProviderOutputRef,
        mimeType: input.mimeType,
      },
      signal,
      (value) => parseReconciliation(value, input.mimeType),
    );
  }

  async createReadGrant(
    _input: CreateReadGrantV1,
    _signal: AbortSignal,
  ): Promise<ReadGrantV1> {
    throw safeFailure(
      'adapter-unavailable',
      'ZX_Z_S_READ_GRANT_UNSUPPORTED',
      'the frozen Z-s output client does not provide read grants',
      false,
      'zx-z-s-read-grant',
    );
  }

  private async post<T>(
    operation: Operation,
    executionId: string,
    attemptId: string,
    body: JsonRecord,
    callerSignal: AbortSignal,
    parse: (value: unknown) => T,
  ): Promise<T> {
    const references = operationReferences(operation, executionId, attemptId);
    const timeoutController = new AbortController();
    const requestSignal = AbortSignal.any([callerSignal, timeoutController.signal]);
    const timeout = setTimeout(() => timeoutController.abort(), this.requestTimeoutMs);
    try {
      let response: Response;
      try {
        response = await this.fetchImpl(`${this.baseUrl}${ROUTES[operation]}`, {
          method: 'POST',
          redirect: 'error',
          credentials: 'omit',
          headers: {
            authorization: `Bearer ${this.bearerToken}`,
            'x-zs-caller-app': 'z-x_app',
            'x-zs-contract-version': '1.0',
            'x-app-correlation-reference': references.correlation,
            'idempotency-key': references.idempotencyKey,
            'content-type': 'application/json',
            accept: 'application/json',
          },
          body: JSON.stringify(body),
          signal: requestSignal,
        });
      } catch (error) {
        if (callerSignal.aborted) throw callerSignal.reason ?? error;
        if (timeoutController.signal.aborted) {
          throw safeFailure(
            'timeout',
            'ZX_Z_S_REQUEST_TIMEOUT',
            'the Z-s request timed out',
            true,
            references.correlation,
          );
        }
        throw safeFailure(
          'storage-output-failure',
          'ZX_Z_S_REQUEST_FAILED',
          'the Z-s request failed safely',
          true,
          references.correlation,
        );
      }

      if (!response.ok) {
        try {
          throw await this.mapHttpFailure(response, requestSignal, references.correlation);
        } catch (error) {
          if (callerSignal.aborted) throw callerSignal.reason ?? error;
          if (timeoutController.signal.aborted) {
            throw safeFailure(
              'timeout',
              'ZX_Z_S_REQUEST_TIMEOUT',
              'the Z-s request timed out',
              true,
              references.correlation,
            );
          }
          throw error;
        }
      }

      try {
        return parse(await readBoundedJson(response, requestSignal));
      } catch (error) {
        if (callerSignal.aborted) throw callerSignal.reason ?? error;
        if (timeoutController.signal.aborted) {
          throw safeFailure(
            'timeout',
            'ZX_Z_S_REQUEST_TIMEOUT',
            'the Z-s request timed out',
            true,
            references.correlation,
          );
        }
        if (error instanceof SafeExecutionError) throw error;
        throw safeFailure(
          'malformed-output',
          'ZX_Z_S_MALFORMED_RESPONSE',
          'the Z-s response was malformed',
          true,
          references.correlation,
        );
      }
    } finally {
      clearTimeout(timeout);
    }
  }

  private async mapHttpFailure(
    response: Response,
    signal: AbortSignal,
    traceId: string,
  ): Promise<SafeExecutionError> {
    const hint = await readUpstreamErrorHint(response, signal);
    if (response.status === 404 || response.status === 501 || isExplicitNotReady(hint.rawCode)) {
      return safeFailure(
        'storage-output-failure',
        'ZX_Z_S_OUTPUT_NOT_READY',
        'the Z-s output route is not ready',
        true,
        traceId,
      );
    }

    const upstreamCode = hint.safeCode;
    if (response.status === 401 || response.status === 403) {
      return safeFailure(
        'storage-output-failure',
        upstreamCode ?? 'ZX_Z_S_AUTH_REJECTED',
        'the Z-s request was rejected',
        false,
        traceId,
      );
    }
    if (response.status === 400 || response.status === 422) {
      return safeFailure(
        'invalid-owner-request',
        upstreamCode ?? 'ZX_Z_S_REQUEST_REJECTED',
        'the Z-s request was invalid',
        false,
        traceId,
      );
    }
    if (response.status === 409) {
      return safeFailure(
        'storage-output-failure',
        upstreamCode ?? 'ZX_Z_S_OUTPUT_CONFLICT',
        'the Z-s output request conflicted',
        false,
        traceId,
      );
    }
    if ([408, 425, 429].includes(response.status) || response.status >= 500) {
      return safeFailure(
        'storage-output-failure',
        upstreamCode ?? 'ZX_Z_S_RETRYABLE_FAILURE',
        'the Z-s request failed retryably',
        true,
        traceId,
      );
    }
    return safeFailure(
      'storage-output-failure',
      upstreamCode ?? 'ZX_Z_S_REQUEST_REJECTED',
      'the Z-s request was rejected safely',
      hint.retryable ?? false,
      traceId,
    );
  }
}
