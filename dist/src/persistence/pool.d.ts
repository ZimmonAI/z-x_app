import pg from 'pg';
export declare function createPool(connectionString: string): pg.Pool;
export declare function applyMigration(pool: pg.Pool, direction: 'up' | 'down'): Promise<void>;
export declare function migrationCurrent(pool: pg.Pool): Promise<boolean>;
