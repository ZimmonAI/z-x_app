import pg from 'pg';import fs from 'node:fs/promises';
export function createPool(connectionString:string):pg.Pool{return new pg.Pool({connectionString,max:10,application_name:'z-x-execution-runner'})}
export async function applyMigration(pool:pg.Pool,direction:'up'|'down'):Promise<void>{const file=`migrations/0001_execution_foundation_${direction}.sql`;await pool.query(await fs.readFile(file,'utf8'))}
export async function migrationCurrent(pool:pg.Pool):Promise<boolean>{const r=await pool.query("select to_regclass('execution.executions') is not null as ok");return r.rows[0]?.ok===true}
