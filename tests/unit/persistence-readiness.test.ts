import type pg from 'pg';
import { vi } from 'vitest';
import { migrationCurrent } from '../../src/persistence/pool.js';

function poolReturning(shape: Record<string, boolean>): {
  pool: pg.Pool;
  query: ReturnType<typeof vi.fn>;
} {
  const query = vi.fn().mockResolvedValue({ rows: [shape] });
  return { pool: { query } as unknown as pg.Pool, query };
}

const liveV1Shape = {
  schema_revisions: true,
  executions: true,
  step_attempts: true,
  temporary_artifacts: true,
  owner_type: true,
  owner_ref: true,
  current_step_instance_id: true,
  legacy_phase_attempts_absent: true,
  legacy_execution_attempts_absent: true,
};

test('readiness accepts the governed live z-x-v1 schema shape', async () => {
  const { pool, query } = poolReturning(liveV1Shape);

  await expect(migrationCurrent(pool)).resolves.toBe(true);
  expect(query).toHaveBeenCalledTimes(1);
});

test('readiness rejects the obsolete phase-engine schema', async () => {
  const { pool } = poolReturning({
    ...liveV1Shape,
    step_attempts: false,
    temporary_artifacts: false,
    owner_type: false,
    owner_ref: false,
    current_step_instance_id: false,
    legacy_phase_attempts_absent: false,
    legacy_execution_attempts_absent: false,
  });

  await expect(migrationCurrent(pool)).resolves.toBe(false);
});

test('readiness rejects a partial generalized schema', async () => {
  const { pool } = poolReturning({
    ...liveV1Shape,
    temporary_artifacts: false,
  });

  await expect(migrationCurrent(pool)).resolves.toBe(false);
});
