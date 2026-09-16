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
}

export type { ZStorageHttpClientOptions };

export function createRealZStorageClient(options: ZStorageHttpClientOptions): ZStorageClient {
  return new ZStorageExactObjectHttpClient(options);
}
