import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import { VIDEO_MAKER_EXECUTION_CONTRACT_VERSION } from '../contracts/video-maker/v1/execution.js';
import { withTransaction } from '../persistence/transaction.js';
import { validateVideoMakerExecutionRequest } from '../validation/video-maker-request.js';
import type {
  ExecutionActionResult,
  ExecutionRecord,
  ExecutionService,
} from './routes/executions.js';

interface VideoMakerDatabaseRow {
  id: string;
  owner_app: string;
  request_fingerprint: string;
  idempotency_key: string;
  status: string;
  request_envelope: unknown;
  cancellation_requested_at: Date | null;
  phase_attempt_count: number;
  reconciliation_open: boolean;
  result_envelope: unknown | null;
  error_envelope: unknown | null;
  current_phase_key: string | null;
  current_phase_ordinal: number | null;
  previous_execution_id: string | null;
  regeneration_feedback_snapshot: string | null;
  safe_continuation_ref: string | null;
  selected_execution_method: string;
}

export interface VideoMakerExecutionRecord extends ExecutionRecord {
  currentPhase?: { key: string; ordinal: number };
  previousExecutionId?: string;
  regenerationFeedback?: string;
  safeContinuationRef?: string;
  executionMethod: string;
}

function conflict(message: string): never {
  throw Object.assign(new Error(message), { statusCode: 409 });
}

function forbidden(message: string): never {
  throw Object.assign(new Error(message), { statusCode: 403 });
}

function mapRecord(row: VideoMakerDatabaseRow): VideoMakerExecutionRecord {
  return {
    id: row.id,
    ownerApp: row.owner_app,
    fingerprint: row.request_fingerprint,
    idempotencyKey: row.idempotency_key,
    status: row.status,
    request: row.request_envelope,
    cancellationRequested: Boolean(row.cancellation_requested_at),
    retryCount: Math.max(0, row.phase_attempt_count - 1),
    reconciliationOpen: row.reconciliation_open,
    executionMethod: row.selected_execution_method,
    ...(row.current_phase_key === null || row.current_phase_ordinal === null
      ? {}
      : {
          currentPhase: {
            key: row.current_phase_key,
            ordinal: row.current_phase_ordinal,
          },
        }),
    ...(row.previous_execution_id === null
      ? {}
      : { previousExecutionId: row.previous_execution_id }),
    ...(row.regeneration_feedback_snapshot === null
      ? {}
      : { regenerationFeedback: row.regeneration_feedback_snapshot }),
    ...(row.safe_continuation_ref === null
      ? {}
      : { safeContinuationRef: row.safe_continuation_ref }),
    ...(row.result_envelope === null ? {} : { result: row.result_envelope }),
    ...(row.error_envelope === null ? {} : { error: row.error_envelope }),
  };
}

async function selectRecord(
  database: pg.Pool | pg.PoolClient,
  owner: string,
  id: string,
  forUpdate = false,
): Promise<VideoMakerDatabaseRow | null> {
  const result = await database.query<VideoMakerDatabaseRow>(
    `select e.id, r.owner_app, r.request_fingerprint, r.idempotency_key,
            e.status, r.request_envelope, e.cancellation_requested_at,
            e.result_envelope, e.error_envelope, e.current_phase_key,
            e.current_phase_ordinal, e.previous_execution_id,
            e.regeneration_feedback_snapshot, e.safe_continuation_ref,
            e.selected_execution_method,
            (select count(*)::int from execution.execution_phase_attempts p
              where p.execution_id=e.id) as phase_attempt_count,
            exists(
              select 1 from execution.execution_reconciliation_cases c
               where c.execution_id=e.id and c.status in ('open','resolving')
            ) as reconciliation_open
       from execution.executions e
       join execution.execution_requests r on r.id=e.request_id
      where e.id=$1 and r.owner_app=$2
        and r.contract_version='zx.video-maker.execution.v1'
      ${forUpdate ? 'for update of e' : ''}`,
    [id, owner],
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
    actorRef: string;
    traceId: string;
    safeMetadata?: Record<string, unknown>;
  },
): Promise<void> {
  await client.query(
    `insert into execution.execution_status_transitions
      (event_key, execution_id, from_status, to_status, reason_family,
       actor_type, actor_ref, trace_id, safe_metadata)
     values ($1,$2,$3,$4,$5,'api',$6,$7,$8)`,
    [
      randomUUID(),
      input.executionId,
      input.fromStatus,
      input.toStatus,
      input.reasonFamily,
      input.actorRef,
      input.traceId,
      input.safeMetadata ?? {},
    ],
  );
}

export class PostgresVideoMakerExecutionService implements ExecutionService {
  constructor(private readonly pool: pg.Pool) {}

  async submit(owner: string, input: unknown) {
    const request = validateVideoMakerExecutionRequest(input);
    if (request.ownerApp !== owner) forbidden('owner mismatch');

    return withTransaction(this.pool, async (client) => {
      const existing = await client.query<{
        id: string;
        request_fingerprint: string;
      }>(
        `select e.id, r.request_fingerprint
           from execution.execution_requests r
           join execution.executions e on e.request_id=r.id
          where r.owner_app=$1 and r.idempotency_key=$2
          for update of r`,
        [owner, request.idempotencyKey],
      );
      const duplicate = existing.rows[0];
      if (duplicate) {
        if (duplicate.request_fingerprint !== request.requestFingerprint) {
          conflict('idempotency conflict');
        }
        const record = await selectRecord(client, owner, duplicate.id);
        if (!record) throw new Error('duplicate video-maker execution record is missing');
        return { code: 200 as const, record: mapRecord(record) };
      }

      let inheritedContinuationRef: string | null = null;
      if (request.requestMode === 'regenerate') {
        const previous = await client.query<{
          owner_app: string;
          status: string;
          safe_continuation_ref: string | null;
        }>(
          `select r.owner_app, e.status, e.safe_continuation_ref
             from execution.executions e
             join execution.execution_requests r on r.id=e.request_id
            where e.id=$1
            for update of e`,
          [request.previousExecutionId],
        );
        const prior = previous.rows[0];
        if (!prior || prior.owner_app !== owner) {
          conflict('regeneration source is unavailable');
        }
        if (!['succeeded', 'failed'].includes(prior.status)) {
          conflict('regeneration source is not terminally eligible');
        }
        if (!prior.safe_continuation_ref) {
          conflict('regeneration source lacks a safe continuation reference');
        }
        inheritedContinuationRef = prior.safe_continuation_ref;
      }

      const requestId = randomUUID();
      const executionId = randomUUID();
      const executionMethod =
        request.toolKey === 'consumer-gpt'
          ? 'video-maker-consumer-gpt-fixture-v1'
          : 'video-maker-google-flow-fixture-v1';
      await client.query(
        `insert into execution.execution_requests
          (id, contract_version, owner_app, owner_action_id, owner_project_id,
           idempotency_key, request_fingerprint, operation_type, tool_key,
           request_mode, request_envelope, trace_id)
         values ($1,$2,$3,$4,$5,$6,$7,null,$8,$9,$10,$11)`,
        [
          requestId,
          request.contractVersion,
          request.ownerApp,
          request.ownerActionId,
          request.ownerProjectId ?? null,
          request.idempotencyKey,
          request.requestFingerprint,
          request.toolKey,
          request.requestMode,
          request,
          request.traceId,
        ],
      );
      await client.query(
        `insert into execution.executions
          (id, request_id, status, priority, timeout_seconds, max_attempts,
           selected_execution_method, current_phase_key, current_phase_ordinal,
           next_phase_eligible_at, previous_execution_id,
           regeneration_feedback_snapshot, safe_continuation_ref)
         values ($1,$2,'accepted',$3,$4,$5,$6,'submit',0,now(),$7,$8,$9)`,
        [
          executionId,
          requestId,
          request.priority,
          request.timeoutPolicy.executionSeconds,
          request.retryPolicy.maxAttempts,
          executionMethod,
          request.previousExecutionId ?? null,
          request.feedback ?? null,
          inheritedContinuationRef,
        ],
      );
      await appendTransition(client, {
        executionId,
        fromStatus: null,
        toStatus: 'accepted',
        reasonFamily: 'video-maker-request-accepted',
        actorRef: owner,
        traceId: request.traceId,
        safeMetadata: {
          ownerActionId: request.ownerActionId,
          toolKey: request.toolKey,
          requestMode: request.requestMode,
        },
      });
      const record = await selectRecord(client, owner, executionId);
      if (!record) throw new Error('created video-maker execution record is missing');
      return { code: 202 as const, record: mapRecord(record) };
    });
  }

  async get(owner: string, id: string): Promise<VideoMakerExecutionRecord | null> {
    const record = await selectRecord(this.pool, owner, id);
    return record ? mapRecord(record) : null;
  }

  async cancel(owner: string, id: string): Promise<ExecutionActionResult | null> {
    return withTransaction(this.pool, async (client) => {
      const record = await selectRecord(client, owner, id, true);
      if (!record) return null;
      if (
        record.cancellation_requested_at ||
        ['succeeded', 'failed', 'cancelled'].includes(record.status)
      ) {
        return {
          code: 200,
          record: { ...mapRecord(record), cancellationAccepted: false },
        };
      }

      const stopImmediately = record.status !== 'running';
      await client.query(
        `update execution.executions
            set cancellation_requested_at=now(),
                status=case when $2 then 'cancelled' else status end,
                current_phase_key=case when $2 then null else current_phase_key end,
                current_phase_ordinal=case when $2 then null else current_phase_ordinal end,
                next_phase_eligible_at=case when $2 then null else next_phase_eligible_at end,
                terminal_at=case when $2 then now() else terminal_at end,
                lock_version=lock_version+1,
                updated_at=now()
          where id=$1`,
        [id, stopImmediately],
      );
      const request = validateVideoMakerExecutionRequest(record.request_envelope);
      if (stopImmediately) {
        await appendTransition(client, {
          executionId: id,
          fromStatus: record.status,
          toStatus: 'cancelled',
          reasonFamily: 'cancelled',
          actorRef: owner,
          traceId: request.traceId,
        });
      }
      const updated = await selectRecord(client, owner, id);
      if (!updated) throw new Error('cancelled video-maker execution record is missing');
      return {
        code: 202,
        record: { ...mapRecord(updated), cancellationAccepted: true },
      };
    });
  }

  async retry(owner: string, id: string): Promise<ExecutionActionResult | null> {
    const record = await selectRecord(this.pool, owner, id);
    if (!record) return null;
    conflict('video-maker retries are bounded phase attempts; regeneration requires a new submit');
  }

  async reconcile(owner: string, id: string): Promise<ExecutionActionResult | null> {
    return withTransaction(this.pool, async (client) => {
      const record = await selectRecord(client, owner, id, true);
      if (!record) return null;
      if (record.reconciliation_open) {
        return { code: 200, record: mapRecord(record) };
      }
      if (
        !['running', 'failed', 'reconciliation-required'].includes(record.status) &&
        !record.safe_continuation_ref
      ) {
        conflict('no reconciliable evidence');
      }

      const request = validateVideoMakerExecutionRequest(record.request_envelope);
      await client.query(
        `insert into execution.execution_reconciliation_cases
          (id, execution_id, attempt_id, case_type, status, reason_family,
           safe_details, detected_at, next_check_at)
         values ($1,$2,null,'operator-request','open','reconciliation-required',$3,now(),now())`,
        [
          randomUUID(),
          id,
          {
            currentPhase: record.current_phase_key,
            safeContinuationRefKnown: Boolean(record.safe_continuation_ref),
          },
        ],
      );
      if (record.status === 'running') {
        await client.query(
          `update execution.executions
              set status='reconciliation-required',
                  next_phase_eligible_at=null,
                  lock_version=lock_version+1,
                  updated_at=now()
            where id=$1`,
          [id],
        );
        await appendTransition(client, {
          executionId: id,
          fromStatus: 'running',
          toStatus: 'reconciliation-required',
          reasonFamily: 'reconciliation-required',
          actorRef: owner,
          traceId: request.traceId,
        });
      }
      const updated = await selectRecord(client, owner, id);
      if (!updated) throw new Error('reconciled video-maker execution record is missing');
      return { code: 202, record: mapRecord(updated) };
    });
  }
}

export class CompositeExecutionService implements ExecutionService {
  constructor(
    private readonly legacy: ExecutionService,
    private readonly videoMaker: PostgresVideoMakerExecutionService,
  ) {}

  async submit(owner: string, input: unknown) {
    if (
      input !== null &&
      typeof input === 'object' &&
      !Array.isArray(input) &&
      (input as { contractVersion?: unknown }).contractVersion ===
        VIDEO_MAKER_EXECUTION_CONTRACT_VERSION
    ) {
      return this.videoMaker.submit(owner, input);
    }
    return this.legacy.submit(owner, input);
  }

  async get(owner: string, id: string) {
    return (await this.videoMaker.get(owner, id)) ?? this.legacy.get(owner, id);
  }

  async cancel(owner: string, id: string) {
    return (await this.videoMaker.cancel(owner, id)) ?? this.legacy.cancel(owner, id);
  }

  async retry(owner: string, id: string) {
    return (await this.videoMaker.retry(owner, id)) ?? this.legacy.retry(owner, id);
  }

  async reconcile(owner: string, id: string) {
    return (await this.videoMaker.reconcile(owner, id)) ?? this.legacy.reconcile(owner, id);
  }
}
