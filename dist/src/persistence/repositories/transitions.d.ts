import type pg from 'pg';
export declare class TransitionsRepository {
    private readonly db;
    constructor(db: pg.Pool | pg.PoolClient);
    append(executionId: string, fromStatus: string | null, toStatus: string, reasonFamily: string, actorType: string, traceId: string, safeMetadata?: Record<string, unknown>): Promise<void>;
}
