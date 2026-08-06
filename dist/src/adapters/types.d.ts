import type { AutoHubDispatchClient } from '../clients/auto-hub.js';
import type { ZStorageClient } from '../clients/z-s.js';
import type { CapacitySnapshotV1, FixtureScenario, RouteSnapshotV1, StorageResultV1 } from '../contracts/v1/dependencies.js';
import type { ExecutionRequestV1, OperationType } from '../contracts/v1/execution.js';
export interface AdapterContext {
    request: ExecutionRequestV1;
    route: RouteSnapshotV1;
    capacity: CapacitySnapshotV1;
    executionId: string;
    attemptId: string;
    signal: AbortSignal;
    autoHub: AutoHubDispatchClient;
    storage: ZStorageClient;
    recordProviderOutput(input: {
        externalRunRef?: string;
        safeProviderOutputRef: string;
    }): Promise<void>;
    /**
     * Compatibility persistence slot. For owner-led requests this stores the opaque
     * owner/delegated output access reference; Z-X does not create that authority.
     */
    recordOutputAuthorization(authorizationRef: string): Promise<void>;
}
export interface AdapterOutput {
    promptText?: string;
    media?: StorageResultV1;
    externalRunRef?: string;
    safeProviderOutputRef?: string;
}
export interface ExecutionAdapter {
    readonly operation: OperationType;
    readonly id: string;
    readonly version: '1.0.0';
    execute(context: AdapterContext): Promise<AdapterOutput>;
}
export declare function fixtureScenario(request: ExecutionRequestV1): FixtureScenario | undefined;
export declare function requiredScalarString(request: ExecutionRequestV1, key: string): string;
export declare function dispatchAndStoreMedia(context: AdapterContext, kind: 'image' | 'video'): Promise<AdapterOutput>;
