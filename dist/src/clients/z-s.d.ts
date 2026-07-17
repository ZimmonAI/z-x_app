import type { CreateOutputAuthorizationV1, CompleteOutputV1, CreateReadGrantV1, OutputAuthorizationV1, StorageResultV1, ReadGrantV1 } from '../contracts/v1/dependencies.js';
export interface ZStorageClient {
    createOutputAuthorization(i: CreateOutputAuthorizationV1, s: AbortSignal): Promise<OutputAuthorizationV1>;
    completeOrIngestOutput(i: CompleteOutputV1, s: AbortSignal): Promise<StorageResultV1>;
    createReadGrant(i: CreateReadGrantV1, s: AbortSignal): Promise<ReadGrantV1>;
}
export declare function createRealZStorageClient(): ZStorageClient;
