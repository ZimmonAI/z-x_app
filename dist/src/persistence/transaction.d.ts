import type pg from 'pg';
export declare function withTransaction<T>(pool: pg.Pool, fn: (c: pg.PoolClient) => Promise<T>): Promise<T>;
