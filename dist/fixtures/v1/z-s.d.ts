import type { ZStorageClient } from '../../src/clients/z-s.js';
import type { CreateOutputAuthorizationV1, CompleteOutputV1, CreateReadGrantV1, OutputAuthorizationV1, StorageResultV1, ReadGrantV1 } from '../../src/contracts/v1/dependencies.js';
export declare class ZStorageFixtureV1 implements ZStorageClient {
    readonly fixtureVersion = "fixture-v1";
    createOutputAuthorization(i: CreateOutputAuthorizationV1, _s: AbortSignal): Promise<OutputAuthorizationV1>;
    completeOrIngestOutput(i: CompleteOutputV1, _s: AbortSignal): Promise<StorageResultV1>;
    createReadGrant(i: CreateReadGrantV1, _s: AbortSignal): Promise<ReadGrantV1>;
}
