import fs from 'node:fs/promises';
import pg from 'pg';

const UP_MIGRATIONS = [
  'migrations/0001_execution_foundation_up.sql',
  'migrations/0002_video_maker_phase_engine_up.sql',
] as const;
const DOWN_MIGRATIONS = [
  'migrations/0002_video_maker_phase_engine_down.sql',
  'migrations/0001_execution_foundation_down.sql',
] as const;

export function testPool(): pg.Pool {
  const url = process.env.ZX_TEST_DATABASE_URL;
  if (!url) {
    throw new Error('ZX_TEST_DATABASE_URL required; integration lane must provide ephemeral PostgreSQL');
  }
  return new pg.Pool({ connectionString: url, max: 4 });
}

export async function reset(pool: pg.Pool): Promise<void> {
  await pool.query('drop schema if exists execution cascade');
  for (const migration of UP_MIGRATIONS) {
    await pool.query(await fs.readFile(migration, 'utf8'));
  }
}

export async function down(pool: pg.Pool): Promise<void> {
  for (const migration of DOWN_MIGRATIONS) {
    await pool.query(await fs.readFile(migration, 'utf8'));
  }
}
