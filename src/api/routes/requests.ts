import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import type { FastifyInstance } from 'fastify';
import {
  CONTRACT_VERSION,
  type RequestResultV1,
  type RequestV1,
} from '../../contracts/v1/request.js';
import { withTransaction } from '../../persistence/transaction.js';
import { validateRequest } from '../../validation/request.js';
import type { AuthVerifier, Principal } from '../auth.js';
import { authenticate, requireScope } from '../auth.js';

export interface PlannedJob {
  id: string;
  ordinal: number;
  targetOutputCount: number;
  bundleVersionId: string;
  storageConnectionId?: string;
}

export interface RequestRecord {
  id: string;
  clientKey: string;
  request: RequestV1;
  state: RequestResultV1['state'];
  jobs: PlannedJob[];
  outputs: RequestResultV1['outputs'];
}

export interface RequestServiceAction {
  code: 200 | 202;
  record: RequestRecord;
}

export interface RequestService {
  submit(clientKey: string, input: unknown): Promise<RequestServiceAction>;
  get(clientKey: string, id: string): Promise<RequestRecord | null>;
  cancel(clientKey: string, id: string): Promise<RequestServiceAction | null>;
}

function conflict(message: string): never {
  throw Object.assign(new Error(message), { statusCode: 409 });
}

function notUsable(message: string): never {
  throw Object.assign(new Error(message), { statusCode: 422 });
}

export function publicRequestResult(record: RequestRecord): RequestResultV1 {
  return {
    contractVersion: CONTRACT_VERSION,
    zxRequestId: record.id,
    ...(record.request.clientRequestRef === undefined
      ? {}
      : { clientRequestRef: record.request.clientRequestRef }),
    state: record.state,
    requestedOutputCount: record.request.requestedOutputCount,
    outputs: record.outputs,
  };
}

function planJobs(request: RequestV1): PlannedJob[] {
  // Generic deterministic baseline: each Job owns one requested output. This
  // proves Request 1:N Job behavior without introducing a business/job taxonomy.
  return Array.from({ length: request.requestedOutputCount }, (_, index) => ({
    id: randomUUID(),
    ordinal: index + 1,
    targetOutputCount: 1,
    bundleVersionId: request.bundleVersionId,
    ...(request.storageConnectionId === undefined
      ? {}
      : { storageConnectionId: request.storageConnectionId }),
  }));
}

export class MemoryRequestService implements RequestService {
  private readonly byId = new Map<string, RequestRecord>();
  private readonly byIdempotency = new Map<string, string>();

  async submit(clientKey: string, input: unknown): Promise<RequestServiceAction> {
    const request = validateRequest(input);
    const key = `${clientKey}\u0000${request.idempotencyKey}`;
    const existingId = this.byIdempotency.get(key);
    if (existingId) {
      const existing = this.byId.get(existingId);
      if (!existing) throw new Error('idempotency index is inconsistent');
      if (existing.request.requestFingerprint !== request.requestFingerprint) {
        conflict('idempotency conflict');
      }
      return { code: 200, record: existing };
    }

    const jobs = planJobs(request);
    const record: RequestRecord = {
      id: randomUUID(),
      clientKey,
      request,
      state: jobs.length === 0 ? 'accepted' : 'planned',
      jobs,
      outputs: [],
    };
    this.byId.set(record.id, record);
    this.byIdempotency.set(key, record.id);
    return { code: 202, record };
  }

  async get(clientKey: string, id: string): Promise<RequestRecord | null> {
    const record = this.byId.get(id);
    return record?.clientKey === clientKey ? record : null;
  }

  async cancel(clientKey: string, id: string): Promise<RequestServiceAction | null> {
    const record = await this.get(clientKey, id);
    if (!record) return null;
    if (['succeeded', 'failed', 'cancelled'].includes(record.state)) {
      return { code: 200, record };
    }
    record.state = 'cancelled';
    return { code: 202, record };
  }
}

interface RequestRow {
  id: string;
  contract_version: string;
  client_key: string;
  client_request_ref: string | null;
  idempotency_key: string;
  request_fingerprint: string;
  bundle_version_id: string;
  storage_connection_id: string | null;
  requested_output_count: number;
  input_payload: Record<string, unknown>;
  state: RequestResultV1['state'];
  trace_id: string | null;
}

function rowToRequest(row: RequestRow): RequestV1 {
  return {
    contractVersion: CONTRACT_VERSION,
    ...(row.client_request_ref === null ? {} : { clientRequestRef: row.client_request_ref }),
    idempotencyKey: row.idempotency_key,
    requestFingerprint: row.request_fingerprint,
    bundleVersionId: row.bundle_version_id,
    ...(row.storage_connection_id === null
      ? {}
      : { storageConnectionId: row.storage_connection_id }),
    requestedOutputCount: row.requested_output_count,
    inputPayload: row.input_payload,
    ...(row.trace_id === null ? {} : { traceId: row.trace_id }),
  };
}

async function selectRequest(
  database: pg.Pool | pg.PoolClient,
  clientKey: string,
  id: string,
  forUpdate = false,
): Promise<RequestRow | null> {
  const result = await database.query<RequestRow>(
    `select id, contract_version, client_key, client_request_ref, idempotency_key,
            request_fingerprint, bundle_version_id, storage_connection_id,
            requested_output_count, input_payload, state, trace_id
       from execution.execution_requests
      where id=$1 and client_key=$2
      ${forUpdate ? 'for update' : ''}`,
    [id, clientKey],
  );
  return result.rows[0] ?? null;
}

async function selectJobs(
  database: pg.Pool | pg.PoolClient,
  request: RequestRow,
): Promise<PlannedJob[]> {
  const result = await database.query<{
    id: string;
    job_ordinal: number;
    target_output_count: number;
  }>(
    `select id, job_ordinal, target_output_count
       from execution.jobs
      where request_id=$1
      order by job_ordinal`,
    [request.id],
  );
  return result.rows.map((row) => ({
    id: row.id,
    ordinal: row.job_ordinal,
    targetOutputCount: row.target_output_count,
    bundleVersionId: request.bundle_version_id,
    ...(request.storage_connection_id === null
      ? {}
      : { storageConnectionId: request.storage_connection_id }),
  }));
}

async function selectOutputs(
  database: pg.Pool | pg.PoolClient,
  request: RequestRow,
): Promise<RequestResultV1['outputs']> {
  const result = await database.query<{
    position: number;
    zx_object_id: string;
    remote_object_id: string | null;
    temporary_artifact_id: string | null;
  }>(
    `select row_number() over (order by j.job_ordinal, zo.object_ordinal)::integer as position,
            zo.id as zx_object_id,
            op.remote_object_id,
            ev.temporary_artifact_id
       from execution.zx_objects zo
       join execution.jobs j on j.id=zo.job_id
       join execution.executions e on e.job_id=j.id
       join execution.execution_final_output_items foi on foi.id=zo.final_output_item_id
       join execution.execution_step_output_items soi on soi.id=foi.source_step_output_item_id
       join execution.execution_values ev on ev.id=soi.execution_value_id
       left join execution.object_placements op
         on op.zx_object_id=zo.id
        and op.storage_connection_id=$2
      where j.request_id=$1
        and zo.validation_state='valid'
      order by j.job_ordinal, zo.object_ordinal`,
    [request.id, request.storage_connection_id],
  );

  return result.rows.flatMap((row) => {
    if (request.storage_connection_id !== null) {
      return row.remote_object_id === null
        ? []
        : [{
            position: row.position,
            zxObjectId: row.zx_object_id,
            externalObjectId: row.remote_object_id,
          }];
    }
    return row.temporary_artifact_id === null
      ? []
      : [{
          position: row.position,
          zxObjectId: row.zx_object_id,
          zxTemporaryArtifactId: row.temporary_artifact_id,
        }];
  });
}

async function materializeRecord(
  database: pg.Pool | pg.PoolClient,
  row: RequestRow,
): Promise<RequestRecord> {
  const [jobs, outputs] = await Promise.all([
    selectJobs(database, row),
    selectOutputs(database, row),
  ]);
  return {
    id: row.id,
    clientKey: row.client_key,
    request: rowToRequest(row),
    state: row.state,
    jobs,
    outputs,
  };
}

export class PostgresRequestService implements RequestService {
  constructor(private readonly pool: pg.Pool) {}

  async submit(clientKey: string, input: unknown): Promise<RequestServiceAction> {
    const request = validateRequest(input);
    return withTransaction(this.pool, async (client) => {
      const duplicate = await client.query<RequestRow>(
        `select id, contract_version, client_key, client_request_ref, idempotency_key,
                request_fingerprint, bundle_version_id, storage_connection_id,
                requested_output_count, input_payload, state, trace_id
           from execution.execution_requests
          where client_key=$1 and idempotency_key=$2
          for update`,
        [clientKey, request.idempotencyKey],
      );
      const existing = duplicate.rows[0];
      if (existing) {
        if (existing.request_fingerprint !== request.requestFingerprint) {
          conflict('idempotency conflict');
        }
        return { code: 200, record: await materializeRecord(client, existing) };
      }

      const bundle = await client.query<{ id: string }>(
        `select bv.id
           from execution.execution_bundle_versions bv
           join execution.execution_bundles b on b.id=bv.bundle_id
          where bv.id=$1
            and bv.release_status='published'
            and b.lifecycle_status='active'
            and (
              b.visibility='public'
              or b.owner_ref=$2
              or exists (
                select 1 from execution.bundle_access_grants g
                 where g.bundle_id=b.id
                   and g.grantee_ref=$2
                   and g.permission in ('use','manage')
              )
            )`,
        [request.bundleVersionId, clientKey],
      );
      if (!bundle.rows[0]) notUsable('bundleVersionId is unavailable to this client');

      if (request.storageConnectionId !== undefined) {
        const storage = await client.query<{ id: string }>(
          `select id from execution.storage_connections
            where id=$1 and client_key=$2 and status='active'`,
          [request.storageConnectionId, clientKey],
        );
        if (!storage.rows[0]) notUsable('storageConnectionId is unavailable to this client');
      }

      const requestId = randomUUID();
      await client.query(
        `insert into execution.execution_requests
          (id, contract_version, client_key, client_request_ref, idempotency_key,
           request_fingerprint, bundle_version_id, storage_connection_id,
           requested_output_count, input_payload, state, trace_id, accepted_at)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'planned',$11,now())`,
        [
          requestId,
          request.contractVersion,
          clientKey,
          request.clientRequestRef ?? null,
          request.idempotencyKey,
          request.requestFingerprint,
          request.bundleVersionId,
          request.storageConnectionId ?? null,
          request.requestedOutputCount,
          request.inputPayload,
          request.traceId ?? null,
        ],
      );

      const jobs = planJobs(request);
      for (const job of jobs) {
        await client.query(
          `insert into execution.jobs
            (id, request_id, job_ordinal, target_output_count, state, planned_at)
           values ($1,$2,$3,$4,'planned',now())`,
          [job.id, requestId, job.ordinal, job.targetOutputCount],
        );
        await client.query(
          `insert into execution.executions (id, job_id, status, priority)
           values ($1,$2,'accepted',5)`,
          [randomUUID(), job.id],
        );
      }

      const row = await selectRequest(client, clientKey, requestId);
      if (!row) throw new Error('created request is missing');
      return { code: 202, record: await materializeRecord(client, row) };
    });
  }

  async get(clientKey: string, id: string): Promise<RequestRecord | null> {
    const row = await selectRequest(this.pool, clientKey, id);
    return row ? materializeRecord(this.pool, row) : null;
  }

  async cancel(clientKey: string, id: string): Promise<RequestServiceAction | null> {
    return withTransaction(this.pool, async (client) => {
      const row = await selectRequest(client, clientKey, id, true);
      if (!row) return null;
      if (['succeeded', 'failed', 'cancelled'].includes(row.state)) {
        return { code: 200, record: await materializeRecord(client, row) };
      }
      await client.query(
        `update execution.execution_requests
            set state='cancelled', terminal_at=now()
          where id=$1`,
        [id],
      );
      await client.query(
        `update execution.jobs
            set state='cancelled', terminal_at=coalesce(terminal_at,now()), updated_at=now()
          where request_id=$1 and state not in ('succeeded','failed','cancelled')`,
        [id],
      );
      await client.query(
        `update execution.executions e
            set status='cancelled', cancellation_requested_at=coalesce(cancellation_requested_at,now()),
                terminal_at=coalesce(terminal_at,now()), lock_version=lock_version+1, updated_at=now()
           from execution.jobs j
          where e.job_id=j.id and j.request_id=$1
            and e.status not in ('succeeded','failed','cancelled')`,
        [id],
      );
      const updated = await selectRequest(client, clientKey, id);
      if (!updated) throw new Error('cancelled request is missing');
      return { code: 202, record: await materializeRecord(client, updated) };
    });
  }
}

class FixedWindowRateLimiter {
  private readonly windows = new Map<string, { startedAt: number; count: number }>();

  consume(key: string, limit: number, durationMilliseconds: number): void {
    const now = Date.now();
    const existing = this.windows.get(key);
    if (!existing || now - existing.startedAt >= durationMilliseconds) {
      this.windows.set(key, { startedAt: now, count: 1 });
      return;
    }
    if (existing.count >= limit) {
      throw Object.assign(new Error('rate limit exceeded'), { statusCode: 429 });
    }
    existing.count += 1;
  }
}

async function principal(
  request: Parameters<typeof authenticate>[0],
  verify: AuthVerifier,
  scope: string,
): Promise<Principal> {
  const authenticated = await authenticate(request, verify);
  requireScope(authenticated, scope);
  return authenticated;
}

export async function requestRoutes(
  app: FastifyInstance,
  options: { verify: AuthVerifier; service: RequestService },
): Promise<void> {
  const limiter = new FixedWindowRateLimiter();

  app.post('/internal/v1/requests', async (request, reply) => {
    const actor = await principal(request, options.verify, 'zx.requests.submit');
    limiter.consume(`${actor.clientKey}:submit`, 20, 60_000);
    const result = await options.service.submit(actor.clientKey, request.body);
    return reply.code(result.code).send(publicRequestResult(result.record));
  });

  app.get('/internal/v1/requests/:zxRequestId', async (request, reply) => {
    const actor = await principal(request, options.verify, 'zx.requests.read');
    limiter.consume(`${actor.clientKey}:read`, 120, 60_000);
    const id = (request.params as { zxRequestId: string }).zxRequestId;
    const record = await options.service.get(actor.clientKey, id);
    return record
      ? publicRequestResult(record)
      : reply.code(404).send({ error: 'not found' });
  });

  app.post('/internal/v1/requests/:zxRequestId/cancel', async (request, reply) => {
    const actor = await principal(request, options.verify, 'zx.requests.cancel');
    limiter.consume(`${actor.clientKey}:cancel`, 30, 60_000);
    const id = (request.params as { zxRequestId: string }).zxRequestId;
    const result = await options.service.cancel(actor.clientKey, id);
    return result
      ? reply.code(result.code).send(publicRequestResult(result.record))
      : reply.code(404).send({ error: 'not found' });
  });
}
