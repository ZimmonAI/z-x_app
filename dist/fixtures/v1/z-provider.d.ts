import type { ZProviderRouteClient } from '../../src/clients/z-provider.js';
import type { ResolveRouteV1, RouteSnapshotV1 } from '../../src/contracts/v1/dependencies.js';
export declare class ZProviderFixtureV1 implements ZProviderRouteClient {
    readonly fixtureVersion = "fixture-v1";
    resolveAndValidateRoute(i: ResolveRouteV1, _s: AbortSignal): Promise<RouteSnapshotV1>;
}
