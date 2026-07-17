import type pg from 'pg';
export declare class ReconciliationsRepository {
    private readonly db;
    constructor(db: pg.Pool | pg.PoolClient);
    open(executionId: string, attemptId: string | null, caseType: string, reasonFamily: string, details?: Record<string, unknown>): Promise<any>;
}
