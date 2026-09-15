import type pg from 'pg';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PostgresGenericExecutionService } from '../../src/api/generic-execution-service.js';
import { reset, testPool } from './db-helper.js';

const CAPABILITY = `${'e'.repeat(96)}.${'f'.repeat(43)}`;

function request(overrides: Record<string, unknown> = {}) {
  return {
    contractVersion: 'zx.execution.v2',
    ownerApp: 'neutral-owner_app',
    ownerActionId: 'action-db-1',
    idempotencyKey: 'idem-db-1',
    requestFingerprint: 'c'.repeat(64),
    executionMethodRef: 'browser-generate-v4',
    payload: { input_uri: 'zs://owner/object-1' },
    runtimeRequirements: [],
    storageAccess: {
      service: 'z-s',
      audience: 'z-x_app',
      capability: CAPABILITY,
    },
    traceId: 'trace-db-1',
    ...overrides,
  };
}

describe('generic delegated Z-s authority persistence', () => {
  let pool: pg.Pool;

  beforeEach(async () => {
    pool = testPool();
    await reset(pool);
  });

  afterEach(async () => {
    await pool.query('drop schema if exists execution cascade');
    await pool.end();
  });

  afterAll(() => undefined);

  it('persists the exact protected capability while owner reads expose only safe execution truth', async () => {
    const service = new PostgresGenericExecutionService(pool);
    const accepted = await service.submit('neutral-owner_app', request());
    const executionId = (accepted.record as unknown as { executionId: string }).executionId;

    const persisted = await pool.query<{
      contract_version: string;
      operation_type: string;
      request_envelope: {
        storageAccess?: { capability?: string };
        executionMethodRef?: string;
      };
    }>(
      `select contract_version, operation_type, request_envelope
         from execution.execution_requests
        where owner_app=$1 and idempotency_key=$2`,
      ['neutral-owner_app', 'idem-db-1'],
    );

    expect(persisted.rows[0]).toMatchObject({
      contract_version: 'zx.execution.v2',
      operation_type: 'generic.execute.v2',
      request_envelope: { executionMethodRef: 'browser-generate-v4' },
    });
    expect(persisted.rows[0]?.request_envelope.storageAccess?.capability).toBe(CAPABILITY);

    const visible = await service.get('neutral-owner_app', executionId);
    expect(JSON.stringify(visible)).not.toContain(CAPABILITY);
    expect(visible).toMatchObject({
      contractVersion: 'zx.execution.v2',
      executionId,
      status: 'accepted',
    });
    expect(await service.get('other-owner_app', executionId)).toBeNull();
  });

  it('rejects a changed delegated capability under an existing idempotency identity', async () => {
    const service = new PostgresGenericExecutionService(pool);
    await service.submit('neutral-owner_app', request());

    await expect(
      service.submit(
        'neutral-owner_app',
        request({
          storageAccess: {
            service: 'z-s',
            audience: 'z-x_app',
            capability: `${'g'.repeat(96)}.${'h'.repeat(43)}`,
          },
        }),
      ),
    ).rejects.toMatchObject({ statusCode: 409 });
  });

  it('preserves the frozen authority across owner cancellation without returning it', async () => {
    const service = new PostgresGenericExecutionService(pool);
    const accepted = await service.submit('neutral-owner_app', request());
    const executionId = (accepted.record as unknown as { executionId: string }).executionId;

    const cancelled = await service.cancel('neutral-owner_app', executionId);
    expect(cancelled?.record).toMatchObject({ status: 'cancelled' });
    expect(JSON.stringify(cancelled?.record)).not.toContain(CAPABILITY);

    const persisted = await pool.query<{ request_envelope: { storageAccess?: { capability?: string } } }>(
      `select r.request_envelope
         from execution.execution_requests r
         join execution.executions e on e.request_id=r.id
        where e.id=$1`,
      [executionId],
    );
    expect(persisted.rows[0]?.request_envelope.storageAccess?.capability).toBe(CAPABILITY);
  });
});
