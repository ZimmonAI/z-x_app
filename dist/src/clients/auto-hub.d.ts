import type { StartRunV1, GetRunV1, CancelRunV1, AutoHubRunV1 } from '../contracts/v1/dependencies.js';
export interface AutoHubDispatchClient {
    startRun(i: StartRunV1, s: AbortSignal): Promise<AutoHubRunV1>;
    getRun(i: GetRunV1, s: AbortSignal): Promise<AutoHubRunV1>;
    cancelRun(i: CancelRunV1, s: AbortSignal): Promise<AutoHubRunV1>;
}
export declare function createRealAutoHubClient(): AutoHubDispatchClient;
