import fs from 'node:fs/promises';
import pg from 'pg';

const direction = process.argv[2];
if (direction !== 'up' && direction !== 'down') {
  throw new Error('usage: node scripts/run-migrations.mjs <up|down>');
}

const connectionString = process.env.ZX_TEST_DATABASE_URL;
if (!connectionString) {
  throw new Error('ZX_TEST_DATABASE_URL required');
}

const manifest = JSON.parse(await fs.readFile('migrations/manifest.json', 'utf8'));
const enabled = manifest.migrations.filter((migration) => migration.enabled === true);
const ordered = direction === 'up' ? enabled : [...enabled].reverse();
const client = new pg.Client({ connectionString });

await client.connect();
try {
  for (const migration of ordered) {
    const path = direction === 'up' ? migration.up : migration.down;
    await client.query(await fs.readFile(path, 'utf8'));
  }
} finally {
  await client.end();
}
