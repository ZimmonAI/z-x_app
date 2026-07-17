import type pg from 'pg';
import type { OperationType } from '../contracts/v1/execution.js';
import type { ClaimedExecution } from './lifecycle.js';
export declare function claimNext(pool: pg.Pool, workerId: string, leaseSeconds?: number, enabledOperations?: readonly OperationType[]): Promise<ClaimedExecution | null>;
