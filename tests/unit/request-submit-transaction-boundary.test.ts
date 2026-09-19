import type pg from 'pg';
import { describe, expect, it } from 'vitest';
import { PostgresRequestService } from '../../src/api/routes/requests.js';

const bundleVersionId = '11111111-1111-4111-8111-111111111111';

const request = {
  contractVersion: 'zx.execution.v1' as const,
  idempotencyKey: 'submit-boundary',
  requestFingerprint: 'a'.repeat(64),
  bundleVersionId,
  requestedOutputCount: 2,
  inputPayload: { prompt: 'test' },
};

function normalize(sql: string): string {
  return sql.replace(/\s+/g, ' ').trim();
}

describe('Postgres Request submit transaction boundary', () => {
  it('commits Request + Jobs + Executions without reading output tables', async () => {
    const queries: string[] = [];
    const client = {
      query: async (sql: string) => {
        const normalized = normalize(sql);
        queries.push(normalized);

        if (normalized === 'begin' || normalized === 'commit' || normalized === 'rollback') {
          return { rows: [], rowCount: 0 };
        }
        if (
          normalized.includes('from execution.execution_requests') &&
          normalized.includes('idempotency_key=$2')
        ) {
          return { rows: [], rowCount: 0 };
        }
        if (normalized.includes('from execution.execution_bundle_versions')) {
          return { rows: [{ id: bundleVersionId }], rowCount: 1 };
        }
        if (
          normalized.startsWith('insert into execution.execution_requests') ||
          normalized.startsWith('insert into execution.jobs') ||
          normalized.startsWith('insert into execution.executions')
        ) {
          return { rows: [], rowCount: 1 };
        }
        throw new Error(`unexpected query during submit: ${normalized}`);
      },
      release: () => undefined,
    };
    const pool = {
      connect: async () => client,
    } as unknown as pg.Pool;

    const result = await new PostgresRequestService(pool).submit('client-a', request);

    expect(result.code).toBe(202);
    expect(result.record.state).toBe('planned');
    expect(result.record.jobs).toHaveLength(2);
    expect(result.record.outputs).toEqual([]);
    expect(queries.at(-1)).toBe('commit');
    expect(queries.some((sql) => sql.includes('execution.zx_objects'))).toBe(false);
    expect(queries.some((sql) => sql.includes('execution.execution_final_output_items'))).toBe(false);
    expect(queries.some((sql) => sql.includes('execution.execution_step_output_items'))).toBe(false);
    expect(queries.some((sql) => sql.includes('execution.execution_values'))).toBe(false);
    expect(queries.some((sql) => sql.includes('execution.object_placements'))).toBe(false);
  });

  it('materializes an idempotent replay only after its transaction commits', async () => {
    const events: string[] = [];
    const existing = {
      id: '22222222-2222-4222-8222-222222222222',
      contract_version: 'zx.execution.v1',
      client_key: 'client-a',
      client_request_ref: null,
      idempotency_key: request.idempotencyKey,
      request_fingerprint: request.requestFingerprint,
      bundle_version_id: bundleVersionId,
      storage_connection_id: null,
      requested_output_count: 2,
      input_payload: request.inputPayload,
      state: 'planned',
      trace_id: null,
    };

    const client = {
      query: async (sql: string) => {
        const normalized = normalize(sql);
        events.push(`tx:${normalized}`);

        if (normalized === 'begin' || normalized === 'commit' || normalized === 'rollback') {
          return { rows: [], rowCount: 0 };
        }
        if (
          normalized.includes('from execution.execution_requests') &&
          normalized.includes('idempotency_key=$2')
        ) {
          return { rows: [existing], rowCount: 1 };
        }
        throw new Error(`unexpected transaction query during replay: ${normalized}`);
      },
      release: () => undefined,
    };

    const pool = {
      connect: async () => client,
      query: async (sql: string) => {
        const normalized = normalize(sql);
        events.push(`read:${normalized}`);

        if (normalized.includes('from execution.jobs')) {
          return {
            rows: [
              {
                id: '33333333-3333-4333-8333-333333333333',
                job_ordinal: 1,
                target_output_count: 1,
              },
              {
                id: '44444444-4444-4444-8444-444444444444',
                job_ordinal: 2,
                target_output_count: 1,
              },
            ],
            rowCount: 2,
          };
        }
        if (normalized.includes('from execution.zx_objects')) {
          return { rows: [], rowCount: 0 };
        }
        throw new Error(`unexpected replay read query: ${normalized}`);
      },
    } as unknown as pg.Pool;

    const result = await new PostgresRequestService(pool).submit('client-a', request);

    const commitIndex = events.indexOf('tx:commit');
    const firstReadIndex = events.findIndex((event) => event.startsWith('read:'));

    expect(result.code).toBe(200);
    expect(result.record.id).toBe(existing.id);
    expect(result.record.jobs).toHaveLength(2);
    expect(commitIndex).toBeGreaterThan(-1);
    expect(firstReadIndex).toBeGreaterThan(commitIndex);
  });
});
