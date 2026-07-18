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
}

export function createRealZStorageClient(): ZStorageClient {
  throw new Error('real Z-s client disabled pending owner-published contract');
}
