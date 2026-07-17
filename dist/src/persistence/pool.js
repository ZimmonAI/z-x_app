import pg from 'pg';
import fs from 'node:fs/promises';
export function createPool(connectionString) { return new pg.Pool({ connectionString, max: 10, application_name: 'z-x-execution-runner' }); }
export async function applyMigration(pool, direction) { const file = `migrations/0001_execution_foundation_${direction}.sql`; await pool.query(await fs.readFile(file, 'utf8')); }
export async function migrationCurrent(pool) { const r = await pool.query("select to_regclass('execution.executions') is not null as ok"); return r.rows[0]?.ok === true; }
//# sourceMappingURL=pool.js.map