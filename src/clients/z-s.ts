import type {
  CreateOutputAuthorizationV1,
  CompleteOutputV1,
  CreateReadGrantV1,
  OutputAuthorizationV1,
  StorageResultV1,
  ReadGrantV1,
  ReconcileOutputV1,
  OutputReconciliationV1,
} from '../contracts/v1/dependencies.js';
import { ZStorageDelegatedOutputHttpClient } from './z-s-delegated-output.js';
import { ZStorageExactObjectHttpClient } from './z-s-exact-object-read.js';
import type { ZStorageHttpClientOptions } from './z-s-http.js';

export interface ExactObjectReadInputV1 {
  executionId: string;
  attemptId: string;
  storageObjectId: string;
  readAuthorityRef: string;
}

export interface ExactObjectReadResultV1 {
  storageObjectId: string;
  mimeType: string;
  sizeBytes: number;
  checksumSha256: string;
  body: ReadableStream<Uint8Array>;
}

export interface DelegatedOutputArtifactV1 {
  artifactRef: string;
  mimeType: string;
  sizeBytes: number;
  checksumSha256: string;
  body: ReadableStream<Uint8Array>;
}

export interface DelegatedOutputIntentV1 {
  executionId: string;
  attemptId: string;
  writeAuthorizationRef: string;
  artifact: Readonly<Omit<DelegatedOutputArtifactV1, 'body'>>;
}

export interface DelegatedOutputIntentResultV1 {
  writeIntentId: string;
  storageObjectId: string;
  uploadCompletionToken: string;
  expiresAt: string;
}

export interface DelegatedOutputWriteV1 {
  executionId: string;
  attemptId: string;
  writeIntentId: string;
  writeAuthorityRef: string;
  artifact: Readonly<DelegatedOutputArtifactV1>;
}

export interface DelegatedStorageResultV1 {
  storageObjectId: string;
  writeIntentId: string;
  checksumSha256: string;
  mimeType: string;
  sizeBytes: number;
  width?: number;
  height?: number;
  durationSeconds?: number;
  objectProtectionStage: string;
  storageState?: 'ready' | 'degraded' | 'unavailable';
}

export interface ZStorageClient {
  createOutputAuthorization(
    input: CreateOutputAuthorizationV1,
    signal: AbortSignal,
  ): Promise<OutputAuthorizationV1>;
  completeOrIngestOutput(input: CompleteOutputV1, signal: AbortSignal): Promise<StorageResultV1>;
  reconcileOutput(
    input: ReconcileOutputV1,
    signal: AbortSignal,
  ): Promise<OutputReconciliationV1>;
  createReadGrant(input: CreateReadGrantV1, signal: AbortSignal): Promise<ReadGrantV1>;
  /**
   * Optional because deterministic fixture/legacy clients do not consume real object bytes.
   * The production Z-s client implements this exact-object path.
   */
  readExactObject?(
    input: ExactObjectReadInputV1,
    signal: AbortSignal,
  ): Promise<ExactObjectReadResultV1>;
  /**
   * Every execution storage dependency used by the worker exposes this seam. The production
   * implementation is the delegated Z-s write-intent client and fixtures implement it
   * deterministically so storage-only reconciliation never has an optional-method race.
   */
  createDelegatedOutputWriteIntent(
    input: DelegatedOutputIntentV1,
    signal: AbortSignal,
  ): Promise<DelegatedOutputIntentResultV1>;
  writeDelegatedOutput(
    input: DelegatedOutputWriteV1,
    signal: AbortSignal,
  ): Promise<DelegatedStorageResultV1>;
}

// The legacy base HTTP client is only constructed directly for its historical output routes.
// Its production execution factory always returns the delegated-output subclass below. This
// structural declaration keeps that base class compatible with its existing interface while
// the actual delegated-write implementation remains owned by ZStorageDelegatedOutputHttpClient.
declare module './z-s-http.js' {
  interface ZStorageHttpClient {
    createDelegatedOutputWriteIntent(
      input: DelegatedOutputIntentV1,
      signal: AbortSignal,
    ): Promise<DelegatedOutputIntentResultV1>;
    writeDelegatedOutput(
      input: DelegatedOutputWriteV1,
      signal: AbortSignal,
    ): Promise<DelegatedStorageResultV1>;
  }
}

class ZStorageObjectIoHttpClient extends ZStorageDelegatedOutputHttpClient {
  readonly #exactObjectReader: ZStorageExactObjectHttpClient;

  constructor(options: ZStorageHttpClientOptions) {
    super(options);
    this.#exactObjectReader = new ZStorageExactObjectHttpClient(options);
  }

  readExactObject(
    input: ExactObjectReadInputV1,
    signal: AbortSignal,
  ): Promise<ExactObjectReadResultV1> {
    return this.#exactObjectReader.readExactObject(input, signal);
  }
}

export type { ZStorageHttpClientOptions };

export function createRealZStorageClient(options: ZStorageHttpClientOptions): ZStorageClient {
  return new ZStorageObjectIoHttpClient(options);
}
