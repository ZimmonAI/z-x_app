import type pg from 'pg';
import { vi } from 'vitest';
import { migrationCurrent } from '../../src/persistence/pool.js';

function poolReturning(
  shape: Record<string, boolean>,
  revision = true,
): { pool: pg.Pool; query: ReturnType<typeof vi.fn> } {
  const query = vi
    .fn()
    .mockResolvedValueOnce({ rows: [shape] })
    .mockResolvedValueOnce({ rows: [{ ok: revision }] });
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

test('readiness accepts the governed live z-x-v1 schema', async () => {
  const { pool, query } = poolReturning(liveV1Shape);

  await expect(migrationCurrent(pool)).resolves.toBe(true);
  expect(query).toHaveBeenCalledTimes(2);
  expect(query.mock.calls[1]?.[1]).toEqual(['z-x-v1']);
});

test('readiness rejects an obsolete phase-engine schema before revision lookup', async () => {
  const { pool, query } = poolReturning({
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
  expect(query).toHaveBeenCalledTimes(1);
});

test('readiness rejects the right shape without the governed z-x-v1 revision', async () => {
  const { pool } = poolReturning(liveV1Shape, false);
  await expect(migrationCurrent(pool)).resolves.toBe(false);
});
