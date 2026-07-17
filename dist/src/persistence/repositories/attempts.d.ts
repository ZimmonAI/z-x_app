import type pg from 'pg';
export declare class AttemptsRepository {
    private readonly db;
    constructor(db: pg.Pool | pg.PoolClient);
    create(executionId: string, attemptNumber: number): Promise<`${string}-${string}-${string}-${string}-${string}`>;
    complete(id: string, leaseToken: string, status: string): Promise<void>;
}
