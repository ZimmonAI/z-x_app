import pg from 'pg';
export declare function testPool(): pg.Pool;
export declare function reset(pool: pg.Pool): Promise<void>;
export declare function down(pool: pg.Pool): Promise<void>;
