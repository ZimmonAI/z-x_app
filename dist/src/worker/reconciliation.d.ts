import type pg from 'pg';
import type { FixtureDependencies } from './lifecycle.js';
export declare function reconcileNextStorageCompletion(pool: pg.Pool, workerId: string, leaseSeconds: number, dependencies: FixtureDependencies, signal?: AbortSignal): Promise<boolean>;
export declare function prepareManualRetry(pool: pg.Pool, workerId: string, leaseSeconds: number, dependencies: FixtureDependencies, signal?: AbortSignal): Promise<boolean>;
export declare function recoverExpiredLeases(pool: pg.Pool): Promise<number>;
