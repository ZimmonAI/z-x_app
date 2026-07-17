import type pg from 'pg';
import type { ExecutionRequestV1 } from '../../contracts/v1/execution.js';
export declare class ExecutionsRepository {
    private readonly db;
    constructor(db: pg.Pool | pg.PoolClient);
    submit(r: ExecutionRequestV1): Promise<{
        kind: "conflict";
        id?: undefined;
        status?: undefined;
    } | {
        kind: "duplicate";
        id: any;
        status: any;
    } | {
        kind: "created";
        id: `${string}-${string}-${string}-${string}-${string}`;
        status: string;
    }>;
    get(id: string, ownerApp: string): Promise<any>;
}
