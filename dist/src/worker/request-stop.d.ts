import { type WorkerStopAcknowledgement } from './control.js';
export declare function waitForWorkerStopAcknowledgement(options: {
    controlDir: string;
    requestId: string;
    timeoutMilliseconds?: number;
    pollMilliseconds?: number;
}): Promise<WorkerStopAcknowledgement>;
export declare function requestWorkerStop(controlDir: string): Promise<WorkerStopAcknowledgement>;
export declare function runWorkerStopCommand(): Promise<void>;
