import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type pg from 'pg';
import { PostgresVideoMakerExecutionService } from '../../src/api/video-maker-execution-service.js';
import {
  VIDEO_MAKER_EXECUTION_CONTRACT_VERSION,
  VIDEO_MAKER_OWNER_STORAGE_ACCESS_VERSION,
  freezeVideoMakerExecutionRequestV1,
  type VideoMakerExecutionRequestV1,
} from '../../src/contracts/video-maker/v1/execution.js';
import {
  runNextVideoMakerPhase,
  type VideoMakerPhaseRunner,
} from '../../src/worker/video-maker-phase-engine.js';
import { reset, testPool } from './db-helper.js';

function request(input: {
  idempotencyKey?: string;
  scenario?: string;
  previousExecutionId?: string;
  feedback?: string;
  maxAttempts?: number;
} = {}): VideoMakerExecutionRequestV1 {
  return freezeVideoMakerExecutionRequestV1({
    contractVersion: VIDEO_MAKER_EXECUTION_CONTRACT_VERSION,
    ownerApp: 'video-maker_app',
    ownerActionId: `action_${randomUUID()}`,
    ownerProjectId: 'project_1',
    idempotencyKey: input.idempotencyKey ?? `idem_${randomUUID()}`,
    traceId: `trace_${randomUUID()}`,
    requestMode: input.previousExecutionId ? 'regenerate' : 'initial',
    ...(input.previousExecutionId
      ? {
          previousExecutionId: input.previousExecutionId,
          ...(input.feedback ? { feedback: input.feedback } : {}),
        }
      : {}),
    frozenInputResources: [],
    ownerStorageAccess: {
      contractVersion: VIDEO_MAKER_OWNER_STORAGE_ACCESS_VERSION,
      outputTargets: [
        {
          pendingResourceId: 'pending_1',
          outputWriteGrantRef: 'write_grant_1',
        },
      ],
    },
    requestedOutput: { kind: 'text', mimeType: 'text/plain', count: 1 },
    retryPolicy: { maxAttempts: input.maxAttempts ?? 3, backoffSeconds: 1 },
    timeoutPolicy: { executionSeconds: 900, phaseSeconds: 300 },
    priority: 5,
    correlation: {
      testCase: 'phase-engine',
      ...(input.scenario ? { fixtureScenario: input.scenario } : {}),
    },
    toolKey: 'consumer-gpt',
    toolParameters: {
      prompt: 'Create a fixture result.',
      inputResourceRoles: [],
      outputKind: 'text',
      generationSettings: {},
    },
  });
}

async function forceDue(pool: pg.Pool, executionId: string): Promise<void> {
  await pool.query(
    'update execution.executions set next_phase_eligible_at=now() where id=$1',
    [executionId],
  );
}

async function runToTerminal(pool: pg.Pool, executionId: string): Promise<string> {
  for (let index = 0; index < 12; index += 1) {
    await forceDue(pool, executionId);
    await runNextVideoMakerPhase(pool, 'worker-test', 60);
    const status = (
      await pool.query<{ status: string }>(
        'select status from execution.executions where id=$1',
        [executionId],
      )
    ).rows[0]?.status;
    if (status && ['succeeded', 'failed', 'cancelled', 'reconciliation-required'].includes(status)) {
      return status;
    }
  }
  throw new Error('execution did not reach a terminal or reconciliation state');
}

describe('video-maker persistence and phase engine', () => {
  let pool: pg.Pool;
  let service: PostgresVideoMakerExecutionService;

  beforeEach(async () => {
    pool = testPool();
    await reset(pool);
    service = new PostgresVideoMakerExecutionService(pool);
  });

  afterEach(async () => {
    await pool.query('drop schema if exists execution cascade');
    await pool.end();
  });

  it('persists the frozen request and advances only DONE phases', async () => {
    const frozen = request();
    const submitted = await service.submit('video-maker_app', frozen);
    expect(submitted.code).toBe(202);
    expect(submitted.record.status).toBe('accepted');
    expect((submitted.record as { currentPhase?: { key: string } }).currentPhase?.key).toBe(
      'submit',
    );

    await runNextVideoMakerPhase(pool, 'worker-test', 60);
    const afterSubmit = await service.get('video-maker_app', submitted.record.id);
    expect(afterSubmit?.status).toBe('queued');
    expect(afterSubmit?.currentPhase).toEqual({ key: 'check-completion', ordinal: 1 });

    const persisted = await pool.query<{ request_envelope: VideoMakerExecutionRequestV1 }>(
      `select r.request_envelope
         from execution.execution_requests r
         join execution.executions e on e.request_id=r.id
        where e.id=$1`,
      [submitted.record.id],
    );
    expect(persisted.rows[0]?.request_envelope).toEqual(frozen);
    await expect(
      pool.query(
        `update execution.execution_requests
            set request_envelope=jsonb_set(request_envelope,'{priority}','9'::jsonb)
          where id=(select request_id from execution.executions where id=$1)`,
        [submitted.record.id],
      ),
    ).rejects.toThrow(/immutable row/);

    expect(await runToTerminal(pool, submitted.record.id)).toBe('succeeded');
    const completed = await service.get('video-maker_app', submitted.record.id);
    expect(completed?.result).toMatchObject({
      contractVersion: 'zx.video-maker.result.v1',
      toolKey: 'consumer-gpt',
    });
    expect(completed?.currentPhase).toBeUndefined();
  });

  it('retains the current phase for WAITING and schedules another bounded check', async () => {
    const submitted = await service.submit(
      'video-maker_app',
      request({ scenario: 'waiting-then-success' }),
    );
    await runNextVideoMakerPhase(pool, 'worker-test', 60);
    await runNextVideoMakerPhase(pool, 'worker-test', 60);

    const waiting = await service.get('video-maker_app', submitted.record.id);
    expect(waiting?.status).toBe('queued');
    expect(waiting?.currentPhase).toEqual({ key: 'check-completion', ordinal: 1 });
    const attempt = await pool.query<{
      status: string;
      next_check_at: Date | null;
    }>(
      `select status, next_check_at
         from execution.execution_phase_attempts
        where execution_id=$1 and phase_key='check-completion'
        order by attempt_number desc limit 1`,
      [submitted.record.id],
    );
    expect(attempt.rows[0]?.status).toBe('waiting');
    expect(attempt.rows[0]?.next_check_at).toBeInstanceOf(Date);

    await forceDue(pool, submitted.record.id);
    await runNextVideoMakerPhase(pool, 'worker-test', 60);
    expect((await service.get('video-maker_app', submitted.record.id))?.currentPhase).toEqual({
      key: 'collect-and-store-result',
      ordinal: 2,
    });
  });

  it('creates another same-phase attempt for retryable failure and stops at terminal failure', async () => {
    const retryable = await service.submit(
      'video-maker_app',
      request({ scenario: 'retryable-then-success' }),
    );
    await runNextVideoMakerPhase(pool, 'worker-test', 60);
    await runNextVideoMakerPhase(pool, 'worker-test', 60);
    expect((await service.get('video-maker_app', retryable.record.id))?.currentPhase).toEqual({
      key: 'check-completion',
      ordinal: 1,
    });
    await forceDue(pool, retryable.record.id);
    await runNextVideoMakerPhase(pool, 'worker-test', 60);
    const attempts = await pool.query<{ status: string; attempt_number: number }>(
      `select status, attempt_number
         from execution.execution_phase_attempts
        where execution_id=$1 and phase_key='check-completion'
        order by attempt_number`,
      [retryable.record.id],
    );
    expect(attempts.rows).toEqual([
      { status: 'retryable-failure', attempt_number: 1 },
      { status: 'done', attempt_number: 2 },
    ]);

    const terminal = await service.submit(
      'video-maker_app',
      request({ scenario: 'terminal-failure' }),
    );
    expect(await runToTerminal(pool, terminal.record.id)).toBe('failed');
    const failed = await service.get('video-maker_app', terminal.record.id);
    expect(failed?.error).toMatchObject({ code: 'ZX_VM_FIXTURE_TERMINAL', retryable: false });
  });

  it('records truthful cancellation as STOPPED during an active bounded phase', async () => {
    const submitted = await service.submit('video-maker_app', request());
    const stoppingRunner: VideoMakerPhaseRunner = {
      async invoke(input) {
        await pool.query(
          'update execution.executions set cancellation_requested_at=now() where id=$1',
          [input.executionId],
        );
        return {
          kind: 'DONE',
          runnerExecutionRef: `runner-${input.executionId}`,
          safeContinuationRef: `continuation-${input.executionId}`,
        };
      },
    };
    await runNextVideoMakerPhase(pool, 'worker-test', 60, stoppingRunner);
    const stopped = await service.get('video-maker_app', submitted.record.id);
    expect(stopped?.status).toBe('cancelled');
    expect(stopped?.cancellationRequested).toBe(true);
    expect(
      (
        await pool.query<{ status: string }>(
          'select status from execution.execution_phase_attempts where execution_id=$1',
          [submitted.record.id],
        )
      ).rows[0]?.status,
    ).toBe('stopped');
  });

  it('opens reconciliation for uncertain submit and never redispatches it automatically', async () => {
    const submitted = await service.submit(
      'video-maker_app',
      request({ scenario: 'uncertain-submit' }),
    );
    expect(await runNextVideoMakerPhase(pool, 'worker-test', 60)).toBe(true);
    const uncertain = await service.get('video-maker_app', submitted.record.id);
    expect(uncertain?.status).toBe('reconciliation-required');
    expect(uncertain?.reconciliationOpen).toBe(true);
    expect(await runNextVideoMakerPhase(pool, 'worker-test', 60)).toBe(false);
    expect(
      (
        await pool.query<{ count: number }>(
          'select count(*)::int count from execution.execution_phase_attempts where execution_id=$1',
          [submitted.record.id],
        )
      ).rows[0]?.count,
    ).toBe(1);
  });

  it('persists safe runner references and append-only bounded evidence', async () => {
    const submitted = await service.submit('video-maker_app', request());
    expect(await runToTerminal(pool, submitted.record.id)).toBe('succeeded');
    const references = await pool.query<{
      runner_execution_ref: string | null;
      safe_continuation_ref: string | null;
      output_authorization_ref: string | null;
      safe_provider_output_ref: string | null;
    }>(
      `select runner_execution_ref, safe_continuation_ref,
              output_authorization_ref, safe_provider_output_ref
         from execution.execution_phase_attempts
        where execution_id=$1
        order by phase_ordinal desc limit 1`,
      [submitted.record.id],
    );
    expect(references.rows[0]).toMatchObject({
      runner_execution_ref: `runner-${submitted.record.id}`,
      safe_continuation_ref: `continuation-${submitted.record.id}`,
      output_authorization_ref: 'write_grant_1',
      safe_provider_output_ref: `provider-output-${submitted.record.id}`,
    });

    const evidence = await pool.query<{ id: number }>(
      'select id from execution.execution_phase_evidence where execution_id=$1 order by id limit 1',
      [submitted.record.id],
    );
    await expect(
      pool.query('delete from execution.execution_phase_evidence where id=$1', [evidence.rows[0]?.id]),
    ).rejects.toThrow(/immutable row/);
    const completedAttempt = await pool.query<{ id: string }>(
      `select id from execution.execution_phase_attempts
        where execution_id=$1 and status='done' order by phase_ordinal limit 1`,
      [submitted.record.id],
    );
    await expect(
      pool.query(
        "update execution.execution_phase_attempts set status='waiting' where id=$1",
        [completedAttempt.rows[0]?.id],
      ),
    ).rejects.toThrow(/completed phase attempt is immutable/);
  });

  it('preserves owner/idempotency semantics', async () => {
    const original = request({ idempotencyKey: 'same_idempotency' });
    const first = await service.submit('video-maker_app', original);
    const duplicate = await service.submit('video-maker_app', original);
    expect(duplicate.code).toBe(200);
    expect(duplicate.record.id).toBe(first.record.id);

    const conflicting = request({ idempotencyKey: 'same_idempotency' });
    await expect(service.submit('video-maker_app', conflicting)).rejects.toThrow(
      /idempotency conflict/,
    );
  });

  it('creates immutable regeneration lineage after failure and success', async () => {
    const failed = await service.submit(
      'video-maker_app',
      request({ scenario: 'terminal-failure' }),
    );
    expect(await runToTerminal(pool, failed.record.id)).toBe('failed');
    const failedRecord = await service.get('video-maker_app', failed.record.id);

    const regeneratedFailed = await service.submit(
      'video-maker_app',
      request({ previousExecutionId: failed.record.id, feedback: 'Use softer motion.' }),
    );
    expect(regeneratedFailed.record.id).not.toBe(failed.record.id);
    expect(regeneratedFailed.record.previousExecutionId).toBe(failed.record.id);
    expect(regeneratedFailed.record.regenerationFeedback).toBe('Use softer motion.');
    expect(regeneratedFailed.record.safeContinuationRef).toBe(
      failedRecord?.safeContinuationRef,
    );

    const succeeded = await service.submit('video-maker_app', request());
    expect(await runToTerminal(pool, succeeded.record.id)).toBe('succeeded');
    const succeededRecord = await service.get('video-maker_app', succeeded.record.id);
    const regeneratedSuccess = await service.submit(
      'video-maker_app',
      request({ previousExecutionId: succeeded.record.id }),
    );
    expect(regeneratedSuccess.record.safeContinuationRef).toBe(
      succeededRecord?.safeContinuationRef,
    );

    await expect(
      pool.query(
        "update execution.executions set result_envelope='{}'::jsonb where id=$1",
        [failed.record.id],
      ),
    ).rejects.toThrow(/terminal video-maker execution truth is immutable/);
  });

  it('rejects cross-owner regeneration at service and database boundaries', async () => {
    const previousRequestId = randomUUID();
    const previousExecutionId = randomUUID();
    await pool.query(
      `insert into execution.execution_requests
        (id, contract_version, owner_app, owner_action_id, idempotency_key,
         request_fingerprint, operation_type, tool_key, request_mode,
         request_envelope, trace_id)
       values ($1,'zx.video-maker.execution.v1','another-owner','other-action','other-idem',$2,
               null,'consumer-gpt','initial','{}'::jsonb,'other-trace')`,
      [previousRequestId, 'a'.repeat(64)],
    );
    await pool.query(
      `insert into execution.executions
        (id, request_id, status, selected_execution_method, safe_continuation_ref, terminal_at)
       values ($1,$2,'failed','video-maker-consumer-gpt-fixture-v1','continuation-other',now())`,
      [previousExecutionId, previousRequestId],
    );

    const regeneration = request({ previousExecutionId });
    await expect(service.submit('video-maker_app', regeneration)).rejects.toThrow(
      /regeneration source is unavailable/,
    );

    const requestId = randomUUID();
    await pool.query(
      `insert into execution.execution_requests
        (id, contract_version, owner_app, owner_action_id, idempotency_key,
         request_fingerprint, operation_type, tool_key, request_mode,
         request_envelope, trace_id)
       values ($1,'zx.video-maker.execution.v1','video-maker_app','action-db','idem-db',$2,
               null,'consumer-gpt','regenerate',$3,'trace-db')`,
      [requestId, regeneration.requestFingerprint, regeneration],
    );
    await expect(
      pool.query(
        `insert into execution.executions
          (id, request_id, status, selected_execution_method,
           current_phase_key, current_phase_ordinal, previous_execution_id,
           safe_continuation_ref)
         values ($1,$2,'accepted','video-maker-consumer-gpt-fixture-v1',
                 'submit',0,$3,'continuation-other')`,
        [randomUUID(), requestId, previousExecutionId],
      ),
    ).rejects.toThrow(/cross-owner regeneration is prohibited/);
  });
});
