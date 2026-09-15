import fs from 'node:fs/promises';
import pg from 'pg';

const MIGRATIONS = [
  'migrations/0001_execution_foundation',
  'migrations/0002_video_maker_phase_engine',
  'migrations/0005_generic_execution_authority_transport',
] as const;

export function createPool(connectionString: string): pg.Pool {
  return new pg.Pool({
    connectionString,
    max: 10,
    application_name: 'z-x-execution-runner',
  });
}

export async function applyMigration(
  pool: pg.Pool,
  direction: 'up' | 'down',
): Promise<void> {
  const migrations = direction === 'up' ? MIGRATIONS : [...MIGRATIONS].reverse();
  for (const migration of migrations) {
    await pool.query(await fs.readFile(`${migration}_${direction}.sql`, 'utf8'));
  }
}

export async function migrationCurrent(pool: pg.Pool): Promise<boolean> {
  const result = await pool.query(
    `select to_regclass('execution.executions') is not null
            and to_regclass('execution.execution_phase_attempts') is not null
            and exists (
              select 1
                from pg_constraint c
                join pg_class t on t.oid=c.conrelid
                join pg_namespace n on n.oid=t.relnamespace
               where n.nspname='execution'
                 and t.relname='execution_requests'
                 and c.conname='execution_requests_contract_version_check'
                 and pg_get_constraintdef(c.oid) like '%zx.execution.v2%'
            ) as ok`,
  );
  return result.rows[0]?.ok === true;
}
