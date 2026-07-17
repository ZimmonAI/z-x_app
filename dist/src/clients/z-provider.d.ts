import type { ResolveRouteV1, RouteSnapshotV1 } from '../contracts/v1/dependencies.js';
export interface ZProviderRouteClient {
    resolveAndValidateRoute(input: ResolveRouteV1, signal: AbortSignal): Promise<RouteSnapshotV1>;
}
export declare function createRealZProviderClient(): ZProviderRouteClient;
