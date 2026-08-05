import fs from 'node:fs/promises';
import pg from 'pg';

const MIGRATIONS = [
  'migrations/0001_execution_foundation',
  'migrations/0002_video_maker_phase_engine',
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
            and to_regclass('execution.execution_phase_attempts') is not null as ok`,
  );
  return result.rows[0]?.ok === true;
}
