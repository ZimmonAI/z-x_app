import type { AutoHubDispatchClient } from '../../src/clients/auto-hub.js';
import type { StartRunV1, GetRunV1, CancelRunV1, AutoHubRunV1 } from '../../src/contracts/v1/dependencies.js';
export declare class AutoHubFixtureV1 implements AutoHubDispatchClient {
    readonly fixtureVersion = "fixture-v1";
    startRun(i: StartRunV1, _s: AbortSignal): Promise<AutoHubRunV1>;
    getRun(i: GetRunV1, _s: AbortSignal): Promise<AutoHubRunV1>;
    cancelRun(i: CancelRunV1, _s: AbortSignal): Promise<AutoHubRunV1>;
}
