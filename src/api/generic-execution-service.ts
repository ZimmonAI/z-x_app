import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import {
  CONTRACT_VERSION,
  ExecutionRequestV2Schema,
  GENERIC_OPERATION_TYPE,
  GenericExecutionViewV2Schema,
  type ExecutionRequestV2,
  type GenericExecutionViewV2,
} from '../contracts/v2/execution.js';
import { withTransaction } from '../persistence/transaction.js';
import type {
  ExecutionActionResult,
  ExecutionRecord,
  ExecutionService,
} from './routes/executions.js';

function conflict(message: string): never {
  throw Object.assign(new Error(message), { statusCode: 409 });
}

function ownerMismatch(): never {
  throw Object.assign(new Error('owner mismatch'), { statusCode: 403 });
}

function asExecutionRecord(view: GenericExecutionViewV2): ExecutionRecord {
  // The shared route is transport-only. Keep the v2 safe projection intact and never
  // widen it to the legacy record shape, which contains the stored request envelope.
  return view as unknown as ExecutionRecord;
}

function cloneView(view: GenericExecutionViewV2): GenericExecutionViewV2 {
  return structuredClone(view);
}

interface MemoryRow {
  ownerApp: string;
  idempotencyKey: string;
  requestFingerprint: string;
  request: ExecutionRequestV2;
  view: GenericExecutionViewV2;
}

export class MemoryGenericExecutionService implements ExecutionService {
  private readonly rows = new Map<string, MemoryRow>();

  async submit(owner: string, raw: unknown) {
    const request = ExecutionRequestV2Schema.parse(raw);
    if (request.ownerApp !== owner) ownerMismatch();

    for (const row of this.rows.values()) {
      if (row.ownerApp !== owner || row.idempotencyKey !== request.idempotencyKey) continue;
      if (
        row.requestFingerprint !== request.requestFingerprint ||
        JSON.stringify(row.request) !== JSON.stringify(request)
      ) {
        conflict('idempotency conflict');
      }
      return { code: 200 as const, record: asExecutionRecord(cloneView(row.view)) };
    }

    const now = new Date().toISOString();
    const view = GenericExecutionViewV2Schema.parse({
      contractVersion: CONTRACT_VERSION,
      executionId: randomUUID(),
      status: 'accepted',
      createdAt: now,
      updatedAt: now,
    });
    this.rows.set(view.executionId, {
      ownerApp: owner,
      idempotencyKey: request.idempotencyKey,
      requestFingerprint: request.requestFingerprint,
      request: structuredClone(request),
      view,
    });
    return { code: 202 as const, record: asExecutionRecord(cloneView(view)) };
  }

  async get(owner: string, id: string): Promise<ExecutionRecord | null> {
    const row = this.rows.get(id);
    return row?.ownerApp === owner ? asExecutionRecord(cloneView(row.view)) : null;
  }

  async cancel(owner: string, id: string): Promise<ExecutionActionResult | null> {
    const row = this.rows.get(id);
    if (!row || row.ownerApp !== owner) return null;
    if (['succeeded', 'failed', 'cancelled', 'timed-out'].includes(row.view.status)) {
      return { code: 200, record: asExecutionRecord(cloneView(row.view)) };
    }
    const now = new Date().toISOString();
    row.view = GenericExecutionViewV2Schema.parse({
      ...row.view,
      status: 'cancelled',
      updatedAt: now,
      terminalAt: now,
    });
    return { code: 202, record: asExecutionRecord(cloneView(row.view)) };
  }

  async retry(owner: string, id: string): Promise<ExecutionActionResult | null> {
    const row = this.rows.get(id);
    if (!row || row.ownerApp !== owner) return null;
    conflict('generic execution retry requires the generalized runtime');
  }

  async reconcile(owner: string, id: string): Promise<ExecutionActionResult | null> {
    const row = this.rows.get(id);
    if (!row || row.ownerApp !== owner) return null;
    conflict('generic execution reconciliation requires the generalized runtime');
  }

  inspectFrozenRequestForTest(owner: string, id: string): ExecutionRequestV2 | null {
    const row = this.rows.get(id);
    return row?.ownerApp === owner ? structuredClone(row.request) : null;
  }
}

interface GenericDatabaseRow {
  execution_id: string;
  status: GenericExecutionViewV2['status'];
  created_at: Date;
  updated_at: Date;
  terminal_at: Date | null;
}

function mapDatabaseView(row: GenericDatabaseRow): GenericExecutionViewV2 {
  return GenericExecutionViewV2Schema.parse({
    contractVersion: CONTRACT_VERSION,
    executionId: row.execution_id,
    status: row.status,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
    ...(row.terminal_at ? { terminalAt: row.terminal_at.toISOString() } : {}),
  });
}

async function selectGenericRecord(
  database: pg.Pool | pg.PoolClient,
  owner: string,
  id: string,
  forUpdate = false,
): Promise<GenericDatabaseRow | null> {
  const result = await database.query<GenericDatabaseRow>(
    `select e.id as execution_id, e.status, e.created_at, e.updated_at, e.terminal_at
       from execution.executions e
       join execution.execution_requests r on r.id=e.request_id
      where e.id=$1 and r.owner_app=$2 and r.contract_version=$3
      ${forUpdate ? 'for update of e' : ''}`,
    [id, owner, CONTRACT_VERSION],
  );
  return result.rows[0] ?? null;
}

async function appendTransition(
  client: pg.PoolClient,
  input: {
    executionId: string;
    fromStatus: string | null;
    toStatus: string;
    reasonFamily: string;
    owner: string;
    traceId: string;
  },
): Promise<void> {
  await client.query(
    `insert into execution.execution_status_transitions
      (event_key, execution_id, attempt_id, from_status, to_status,
       reason_family, actor_type, actor_ref, trace_id, safe_metadata)
     values ($1,$2,null,$3,$4,$5,'api',$6,$7,'{}'::jsonb)`,
    [
      randomUUID(),
      input.executionId,
      input.fromStatus,
      input.toStatus,
      input.reasonFamily,
      input.owner,
      input.traceId,
    ],
  );
}

export class PostgresGenericExecutionService implements ExecutionService {
  constructor(private readonly pool: pg.Pool) {}

  async submit(owner: string, raw: unknown) {
    const request = ExecutionRequestV2Schema.parse(raw);
    if (request.ownerApp !== owner) ownerMismatch();

    return withTransaction(this.pool, async (client) => {
      const existing = await client.query<{
        execution_id: string;
        contract_version: string;
        request_fingerprint: string;
        same_request: boolean;
      }>(
        `select e.id as execution_id, r.contract_version, r.request_fingerprint,
                r.request_envelope = $3::jsonb as same_request
           from execution.execution_requests r
           join execution.executions e on e.request_id=r.id
          where r.owner_app=$1 and r.idempotency_key=$2
          for update of r`,
        [owner, request.idempotencyKey, JSON.stringify(request)],
      );
      const duplicate = existing.rows[0];
      if (duplicate) {
        if (
          duplicate.contract_version !== CONTRACT_VERSION ||
          duplicate.request_fingerprint !== request.requestFingerprint ||
          !duplicate.same_request
        ) {
          conflict('idempotency conflict');
        }
        const record = await selectGenericRecord(client, owner, duplicate.execution_id);
        if (!record) throw new Error('duplicate generic execution record is missing');
        return { code: 200 as const, record: asExecutionRecord(mapDatabaseView(record)) };
      }

      const requestId = randomUUID();
      const executionId = randomUUID();
      await client.query(
        `insert into execution.execution_requests
          (id, contract_version, owner_app, owner_action_id, owner_project_id,
           idempotency_key, request_fingerprint, operation_type,
           request_envelope, trace_id)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [
          requestId,
          CONTRACT_VERSION,
          request.ownerApp,
          request.ownerActionId,
          request.ownerProjectId ?? null,
          request.idempotencyKey,
          request.requestFingerprint,
          GENERIC_OPERATION_TYPE,
          request,
          request.traceId,
        ],
      );
      await client.query(
        `insert into execution.executions
          (id, request_id, status, priority, timeout_seconds, max_attempts)
         values ($1,$2,'accepted',$3,$4,$5)`,
        [
          executionId,
          requestId,
          request.priority,
          request.timeoutPolicy.timeoutSeconds,
          request.retryPolicy.maxAttempts,
        ],
      );
      await appendTransition(client, {
        executionId,
        fromStatus: null,
        toStatus: 'accepted',
        reasonFamily: 'generic-request-accepted',
        owner,
        traceId: request.traceId,
      });
      const record = await selectGenericRecord(client, owner, executionId);
      if (!record) throw new Error('created generic execution record is missing');
      return { code: 202 as const, record: asExecutionRecord(mapDatabaseView(record)) };
    });
  }

  async get(owner: string, id: string): Promise<ExecutionRecord | null> {
    const record = await selectGenericRecord(this.pool, owner, id);
    return record ? asExecutionRecord(mapDatabaseView(record)) : null;
  }

  async cancel(owner: string, id: string): Promise<ExecutionActionResult | null> {
    return withTransaction(this.pool, async (client) => {
      const record = await selectGenericRecord(client, owner, id, true);
      if (!record) return null;
      if (['succeeded', 'failed', 'cancelled', 'timed-out'].includes(record.status)) {
        return { code: 200, record: asExecutionRecord(mapDatabaseView(record)) };
      }
      const trace = await client.query<{ trace_id: string }>(
        `select r.trace_id
           from execution.executions e
           join execution.execution_requests r on r.id=e.request_id
          where e.id=$1`,
        [id],
      );
      const traceId = trace.rows[0]?.trace_id;
      if (!traceId) throw new Error('generic execution trace is missing');

      const terminalImmediately = !['running', 'reconciliation-required'].includes(record.status);
      await client.query(
        `update execution.executions
            set cancellation_requested_at=now(),
                status=case when $2 then 'cancelled' else status end,
                terminal_at=case when $2 then now() else terminal_at end,
                lock_version=lock_version+1, updated_at=now()
          where id=$1`,
        [id, terminalImmediately],
      );
      if (terminalImmediately) {
        await appendTransition(client, {
          executionId: id,
          fromStatus: record.status,
          toStatus: 'cancelled',
          reasonFamily: 'cancelled',
          owner,
          traceId,
        });
      }
      const updated = await selectGenericRecord(client, owner, id);
      if (!updated) throw new Error('cancelled generic execution record is missing');
      return { code: 202, record: asExecutionRecord(mapDatabaseView(updated)) };
    });
  }

  async retry(owner: string, id: string): Promise<ExecutionActionResult | null> {
    const record = await selectGenericRecord(this.pool, owner, id);
    if (!record) return null;
    conflict('generic execution retry requires the generalized runtime');
  }

  async reconcile(owner: string, id: string): Promise<ExecutionActionResult | null> {
    const record = await selectGenericRecord(this.pool, owner, id);
    if (!record) return null;
    conflict('generic execution reconciliation requires the generalized runtime');
  }
}
