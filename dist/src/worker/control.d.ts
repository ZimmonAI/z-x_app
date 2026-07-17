export declare const WORKER_STOP_REQUEST_FILE = "stop.request.json";
export declare const WORKER_STOP_ACK_FILE = "stop.ack.json";
export interface WorkerStopRequest {
    requestId: string;
    requestedAt: string;
}
export type WorkerStopResult = 'drained' | 'drain-timeout';
export interface WorkerStopAcknowledgement {
    requestId: string;
    result: WorkerStopResult;
    requestedAt: string;
    shutdownStartedAt: string;
    acknowledgedAt: string;
}
export declare function parseWorkerStopRequest(contents: string): WorkerStopRequest;
export declare function parseWorkerStopAcknowledgement(contents: string): WorkerStopAcknowledgement;
export declare function workerControlPaths(controlDir: string): {
    requestPath: string;
    acknowledgementPath: string;
};
export declare function writeWorkerStopRequest(controlDir: string, request: WorkerStopRequest): Promise<void>;
export declare function observeWorkerStopRequest(controlDir: string, beginShutdown: () => void): Promise<WorkerStopRequest | undefined>;
export declare function writeWorkerStopAcknowledgement(controlDir: string, acknowledgement: WorkerStopAcknowledgement): Promise<void>;
export declare function removeWorkerStopRequestIfMatching(controlDir: string, requestId: string): Promise<void>;
export declare function readWorkerStopAcknowledgement(controlDir: string): Promise<WorkerStopAcknowledgement | undefined>;
export declare function removeWorkerStopAcknowledgement(controlDir: string): Promise<void>;
