import type { ZStorageClient } from '../../src/clients/z-s.js';
import type { CreateOutputAuthorizationV1, CompleteOutputV1, CreateReadGrantV1, OutputAuthorizationV1, StorageResultV1, ReadGrantV1, ReconcileOutputV1, OutputReconciliationV1 } from '../../src/contracts/v1/dependencies.js';
export declare class ZStorageFixtureV1 implements ZStorageClient {
    readonly fixtureVersion = "fixture-v1";
    createOutputAuthorization(input: CreateOutputAuthorizationV1, _signal: AbortSignal): Promise<OutputAuthorizationV1>;
    completeOrIngestOutput(input: CompleteOutputV1, _signal: AbortSignal): Promise<StorageResultV1>;
    reconcileOutput(value: ReconcileOutputV1, _signal: AbortSignal): Promise<OutputReconciliationV1>;
    createReadGrant(input: CreateReadGrantV1, _signal: AbortSignal): Promise<ReadGrantV1>;
}
