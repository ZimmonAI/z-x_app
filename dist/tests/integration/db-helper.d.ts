import pg from 'pg';
export declare function testPool(): import("pg").Pool;
export declare function reset(pool: pg.Pool): Promise<void>;
export declare function down(pool: pg.Pool): Promise<void>;
