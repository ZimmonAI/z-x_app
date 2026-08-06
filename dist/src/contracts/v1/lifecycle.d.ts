export declare const EXECUTION_STATES: readonly ["accepted", "resolving-route", "waiting-capacity", "queued", "running", "succeeded", "failed", "cancelled", "timed-out", "reconciliation-required"];
export type ExecutionState = typeof EXECUTION_STATES[number];
export declare const TERMINAL_STATES: Set<"accepted" | "succeeded" | "cancelled" | "running" | "reconciliation-required" | "failed" | "timed-out" | "queued" | "resolving-route" | "waiting-capacity">;
export declare function canTransition(from: ExecutionState, to: ExecutionState, hasManualRetryCase?: boolean): boolean;
export declare function assertTransition(from: ExecutionState, to: ExecutionState, manual?: boolean): void;
