import type pg from 'pg';
export declare class DeliveriesRepository {
    private readonly db;
    constructor(db: pg.Pool | pg.PoolClient);
    ensure(executionId: string, kind: string, correlation: string): Promise<void>;
}
