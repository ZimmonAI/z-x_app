import type pg from 'pg';
import type { AuthVerifier } from '../auth.js';
import type { FastifyInstance } from 'fastify';
export interface ExecutionRecord {
    id: string;
    ownerApp: string;
    fingerprint: string;
    idempotencyKey: string;
    status: string;
    request: unknown;
    cancellationRequested: boolean;
    cancellationAccepted?: boolean;
    retryCount: number;
    reconciliationOpen: boolean;
    result?: unknown;
    error?: unknown;
}
export interface ExecutionActionResult {
    code: 200 | 202;
    record: ExecutionRecord;
}
export interface ExecutionService {
    submit(owner: string, input: unknown): Promise<{
        code: 200 | 202;
        record: ExecutionRecord;
    }>;
    get(owner: string, id: string): Promise<ExecutionRecord | null>;
    cancel(owner: string, id: string): Promise<ExecutionActionResult | null>;
    retry(owner: string, id: string): Promise<ExecutionActionResult | null>;
    reconcile(owner: string, id: string): Promise<ExecutionActionResult | null>;
}
export declare class MemoryExecutionService implements ExecutionService {
    private readonly rows;
    submit(owner: string, input: unknown): Promise<{
        code: 200;
        record: ExecutionRecord;
    } | {
        code: 202;
        record: ExecutionRecord;
    }>;
    get(owner: string, id: string): Promise<ExecutionRecord | null>;
    cancel(owner: string, id: string): Promise<ExecutionActionResult | null>;
    retry(owner: string, id: string): Promise<ExecutionActionResult | null>;
    reconcile(owner: string, id: string): Promise<ExecutionActionResult | null>;
}
export declare class PostgresExecutionService implements ExecutionService {
    private readonly pool;
    constructor(pool: pg.Pool);
    submit(owner: string, input: unknown): Promise<{
        code: 200;
        record: ExecutionRecord;
    } | {
        code: 202;
        record: ExecutionRecord;
    }>;
    get(owner: string, id: string): Promise<ExecutionRecord | null>;
    cancel(owner: string, id: string): Promise<ExecutionActionResult | null>;
    retry(owner: string, id: string): Promise<ExecutionActionResult | null>;
    reconcile(owner: string, id: string): Promise<ExecutionActionResult | null>;
}
export declare function executionRoutes(app: FastifyInstance, options: {
    verify: AuthVerifier;
    service: ExecutionService;
}): Promise<void>;
