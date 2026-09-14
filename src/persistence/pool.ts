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
  const result = await pool.query<{
    schema_revisions: boolean;
    executions: boolean;
    step_attempts: boolean;
    temporary_artifacts: boolean;
    owner_type: boolean;
    owner_ref: boolean;
    current_step_instance_id: boolean;
    legacy_phase_attempts_absent: boolean;
    legacy_execution_attempts_absent: boolean;
  }>(
    `select
       to_regclass('execution.schema_revisions') is not null as schema_revisions,
       to_regclass('execution.executions') is not null as executions,
       to_regclass('execution.execution_step_attempts') is not null as step_attempts,
       to_regclass('execution.temporary_artifacts') is not null as temporary_artifacts,
       exists (
         select 1
           from information_schema.columns
          where table_schema='execution'
            and table_name='execution_requests'
            and column_name='owner_type'
       ) as owner_type,
       exists (
         select 1
           from information_schema.columns
          where table_schema='execution'
            and table_name='execution_requests'
            and column_name='owner_ref'
       ) as owner_ref,
       exists (
         select 1
           from information_schema.columns
          where table_schema='execution'
            and table_name='executions'
            and column_name='current_step_instance_id'
       ) as current_step_instance_id,
       to_regclass('execution.execution_phase_attempts') is null
         as legacy_phase_attempts_absent,
       to_regclass('execution.execution_attempts') is null
         as legacy_execution_attempts_absent`,
  );

  const current = result.rows[0];
  return Boolean(
    current?.schema_revisions &&
      current.executions &&
      current.step_attempts &&
      current.temporary_artifacts &&
      current.owner_type &&
      current.owner_ref &&
      current.current_step_instance_id &&
      current.legacy_phase_attempts_absent &&
      current.legacy_execution_attempts_absent,
  );
}
