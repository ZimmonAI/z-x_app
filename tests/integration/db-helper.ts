import fs from 'node:fs/promises';
import pg from 'pg';

interface MigrationEntry {
  up: string;
  down: string;
  enabled: boolean;
  expectedTableCountAfterUp: number;
}

async function enabledMigrations(): Promise<MigrationEntry[]> {
  const manifest = JSON.parse(await fs.readFile('migrations/manifest.json', 'utf8')) as {
    migrations: MigrationEntry[];
  };
  return manifest.migrations.filter((migration) => migration.enabled);
}

export function testPool(): pg.Pool {
  const url = process.env.ZX_TEST_DATABASE_URL;
  if (!url) {
    throw new Error('ZX_TEST_DATABASE_URL required; integration lane must provide ephemeral PostgreSQL');
  }
  return new pg.Pool({ connectionString: url, max: 4 });
}

export async function expectedTableCountAfterUp(): Promise<number> {
  const migrations = await enabledMigrations();
  const last = migrations.at(-1);
  if (!last) {
    throw new Error('migration manifest has no enabled migrations');
  }
  return last.expectedTableCountAfterUp;
}

export async function reset(pool: pg.Pool): Promise<void> {
  await pool.query('drop schema if exists execution cascade');
  for (const migration of await enabledMigrations()) {
    await pool.query(await fs.readFile(migration.up, 'utf8'));
  }
}

export async function down(pool: pg.Pool): Promise<void> {
  for (const migration of (await enabledMigrations()).reverse()) {
    await pool.query(await fs.readFile(migration.down, 'utf8'));
  }
}
