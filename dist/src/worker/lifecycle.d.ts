import type pg from 'pg';
import type { AdapterOutput } from '../adapters/types.js';
import type { AutoHubDispatchClient } from '../clients/auto-hub.js';
import type { VideoMakerExecutionPort } from '../clients/video-maker.js';
import type { ZAccountCapacityClient } from '../clients/z-account.js';
import type { ZProviderRouteClient } from '../clients/z-provider.js';
import type { ZStorageClient } from '../clients/z-s.js';
import type { CapacitySnapshotV1, RouteSnapshotV1 } from '../contracts/v1/dependencies.js';
import type { ExecutionRequestV1 } from '../contracts/v1/execution.js';
export interface FixtureDependencies {
    routes: ZProviderRouteClient;
    capacity: ZAccountCapacityClient;
    autoHub: AutoHubDispatchClient;
    storage: ZStorageClient;
    owner?: VideoMakerExecutionPort;
}
export interface ClaimedExecution {
    executionId: string;
    attemptId: string;
    leaseToken: string;
}
interface AttemptProviderOutputRecord {
    externalRunRef?: string;
    safeProviderOutputRef: string;
}
export declare function executePreparedFixturePath(request: ExecutionRequestV1, executionId: string, route: RouteSnapshotV1, capacity: CapacitySnapshotV1, dependencies: FixtureDependencies, signal?: AbortSignal, persistence?: {
    attemptId: string;
    recordProviderOutput(input: AttemptProviderOutputRecord): Promise<void>;
    recordOutputAuthorization(authorizationRef: string): Promise<void>;
}): Promise<AdapterOutput>;
export declare function executeFixturePath(request: ExecutionRequestV1, executionId: string, dependencies: FixtureDependencies, signal?: AbortSignal): Promise<AdapterOutput>;
export declare function prepareNextExecution(pool: pg.Pool, workerId: string, leaseSeconds: number, dependencies: FixtureDependencies, signal?: AbortSignal): Promise<boolean>;
export declare function completeClaimedExecution(pool: pg.Pool, claim: ClaimedExecution, workerId: string, dependencies: FixtureDependencies, signal?: AbortSignal): Promise<void>;
export {};
