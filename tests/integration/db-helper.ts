import pg from 'pg';import fs from 'node:fs/promises';
export function testPool(){const u=process.env.ZX_TEST_DATABASE_URL;if(!u)throw new Error('ZX_TEST_DATABASE_URL required; integration lane must provide ephemeral PostgreSQL');return new pg.Pool({connectionString:u,max:4})}
export async function reset(pool:pg.Pool){await pool.query('drop schema if exists execution cascade');await pool.query(await fs.readFile('migrations/0001_execution_foundation_up.sql','utf8'))}
export async function down(pool:pg.Pool){await pool.query(await fs.readFile('migrations/0001_execution_foundation_down.sql','utf8'))}
