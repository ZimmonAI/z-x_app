import type pg from 'pg';
export declare function heartbeat(pool: pg.Pool, attemptId: string, leaseToken: string, leaseSeconds?: number): Promise<boolean>;
export declare function heartbeatWithSingleRetry(pool: pg.Pool, attemptId: string, leaseToken: string, leaseSeconds?: number): Promise<boolean>;
export declare function startHeartbeatLoop(input: {
    pool: pg.Pool;
    attemptId: string;
    leaseToken: string;
    leaseSeconds: number;
    heartbeatSeconds: number;
    onLeaseLost: () => void;
}): () => void;
