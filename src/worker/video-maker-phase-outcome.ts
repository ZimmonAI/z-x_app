import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import {
  VIDEO_MAKER_PHASES,
  fixtureVideoMakerResult,
  type VideoMakerPhaseKey,
  type VideoMakerPhaseOutcome,
} from './video-maker-phase-runner.js';
import {
  appendVideoMakerEvidence,
  appendVideoMakerTransition,
  attemptStatus,
  type PhaseClaim,
} from './video-maker-phase-claim.js';
import { withTransaction } from '../persistence/transaction.js';

function outcomeFailure(
  claim: PhaseClaim,
  outcome: VideoMakerPhaseOutcome,
): Record<string, unknown> | null {
  if (outcome.failure) return outcome.failure;
  if (outcome.kind === 'DONE' || outcome.kind === 'WAITING') return null;
  return {
    contractVersion: 'zx.video-maker.failure.v1',
    code: `ZX_VM_${outcome.kind}`,
    message: 'video-maker phase ended without a supplied normalized failure',
    retryable: outcome.kind === 'RETRYABLE_FAILURE',
    phaseKey: claim.phaseKey,
    attemptNumber: claim.attemptNumber,
    traceId: claim.request.traceId,
  };
}

export async function persistPhaseOutcome(
  pool: pg.Pool,
  claim: PhaseClaim,
  workerId: string,
  proposedOutcome: VideoMakerPhaseOutcome,
): Promise<void> {
  await withTransaction(pool, async (client) => {
    const selected = await client.query<{
      status: string;
      current_phase_key: VideoMakerPhaseKey;
      current_phase_ordinal: number;
      cancellation_requested_at: Date | null;
      safe_continuation_ref: string | null;
    }>(
      `select e.status, e.current_phase_key, e.current_phase_ordinal,
              e.cancellation_requested_at, e.safe_continuation_ref
         from execution.executions e
         join execution.execution_phase_attempts p on p.execution_id=e.id
        where e.id=$1 and p.id=$2 and p.lease_token=$3
          and p.status='running' and p.lease_expires_at>now()
        for update of e, p`,
      [claim.executionId, claim.phaseAttemptId, claim.leaseToken],
    );
    const state = selected.rows[0];
    if (!state) throw new Error('video-maker phase lease was lost');
    if (
      state.current_phase_key !== claim.phaseKey ||
      state.current_phase_ordinal !== claim.phaseOrdinal
    ) {
      throw new Error('video-maker phase pointer changed while claimed');
    }

    const outcome: VideoMakerPhaseOutcome = state.cancellation_requested_at
      ? {
          kind: 'STOPPED',
          failure: {
            contractVersion: 'zx.video-maker.failure.v1',
            code: 'ZX_VM_CANCELLED',
            message: 'cancellation was requested',
            retryable: false,
            phaseKey: claim.phaseKey,
            attemptNumber: claim.attemptNumber,
            traceId: claim.request.traceId,
          },
          evidence: { cancellationRequested: true },
        }
      : proposedOutcome;

    const continuationRef = outcome.safeContinuationRef ?? state.safe_continuation_ref;
    if (
      state.safe_continuation_ref !== null &&
      outcome.safeContinuationRef !== undefined &&
      state.safe_continuation_ref !== outcome.safeContinuationRef
    ) {
      throw new Error('safe continuation reference replacement was rejected');
    }
    if (claim.phaseKey === 'submit' && outcome.kind === 'DONE' && !continuationRef) {
      throw new Error('submit DONE requires a safe continuation reference');
    }

    const failure = outcomeFailure(claim, outcome);
    const nextCheckSeconds = Math.max(
      1,
      Math.min(
        300,
        outcome.nextCheckSeconds ?? claim.request.retryPolicy.backoffSeconds,
      ),
    );

    await client.query(
      `update execution.execution_phase_attempts
          set status=$4, completed_at=now(),
              next_check_at=case when $4 in ('waiting','retryable-failure')
                                 then now()+make_interval(secs=>$5) else null end,
              runner_execution_ref=$6,
              safe_continuation_ref=$7,
              output_authorization_ref=$8,
              safe_provider_output_ref=$9,
              normalized_result=$10,
              normalized_failure=$11
        where id=$1 and execution_id=$2 and lease_token=$3 and status='running'`,
      [
        claim.phaseAttemptId,
        claim.executionId,
        claim.leaseToken,
        attemptStatus(outcome.kind),
        nextCheckSeconds,
        outcome.runnerExecutionRef ?? null,
        continuationRef ?? null,
        outcome.outputAuthorizationRef ?? null,
        outcome.safeProviderOutputRef ?? null,
        outcome.result ?? null,
        failure,
      ],
    );
    await appendVideoMakerEvidence(client, {
      executionId: claim.executionId,
      phaseAttemptId: claim.phaseAttemptId,
      evidenceKind: outcome.kind === 'STOPPED' ? 'shutdown' : 'outcome',
      safeEvidence: {
        phaseKey: claim.phaseKey,
        attemptNumber: claim.attemptNumber,
        outcome: outcome.kind,
        runnerExecutionRefKnown: Boolean(outcome.runnerExecutionRef),
        safeContinuationRefKnown: Boolean(continuationRef),
        outputAuthorizationRefKnown: Boolean(outcome.outputAuthorizationRef),
        safeProviderOutputRefKnown: Boolean(outcome.safeProviderOutputRef),
        ...(outcome.evidence ?? {}),
      },
    });

    let executionStatus: string;
    let reasonFamily: string;
    let nextPhaseKey: VideoMakerPhaseKey | null = claim.phaseKey;
    let nextPhaseOrdinal: number | null = claim.phaseOrdinal;
    let nextEligibleSeconds: number | null = null;
    let resultEnvelope: Record<string, unknown> | null = null;
    let errorEnvelope: Record<string, unknown> | null = null;
    let terminal = false;

    if (outcome.kind === 'DONE') {
      if (claim.phaseOrdinal === VIDEO_MAKER_PHASES.length - 1) {
        executionStatus = 'succeeded';
        reasonFamily = 'phase-flow-completed';
        nextPhaseKey = null;
        nextPhaseOrdinal = null;
        resultEnvelope = outcome.result ?? fixtureVideoMakerResult({
          executionId: claim.executionId,
          phaseKey: claim.phaseKey,
          phaseOrdinal: claim.phaseOrdinal,
          attemptNumber: claim.attemptNumber,
          request: claim.request,
          ...(continuationRef ? { safeContinuationRef: continuationRef } : {}),
          signal: new AbortController().signal,
        });
        terminal = true;
      } else {
        executionStatus = 'queued';
        reasonFamily = 'phase-advanced';
        nextPhaseOrdinal = claim.phaseOrdinal + 1;
        nextPhaseKey = VIDEO_MAKER_PHASES[nextPhaseOrdinal] ?? null;
        nextEligibleSeconds = 0;
      }
    } else if (outcome.kind === 'WAITING') {
      executionStatus = 'queued';
      reasonFamily = 'phase-waiting';
      nextEligibleSeconds = nextCheckSeconds;
    } else if (outcome.kind === 'RETRYABLE_FAILURE') {
      if (claim.attemptNumber >= claim.request.retryPolicy.maxAttempts) {
        executionStatus = 'failed';
        reasonFamily = 'phase-retries-exhausted';
        errorEnvelope = {
          ...(failure ?? {}),
          code: 'ZX_VM_PHASE_RETRIES_EXHAUSTED',
          retryable: false,
        };
        nextPhaseKey = null;
        nextPhaseOrdinal = null;
        terminal = true;
      } else {
        executionStatus = 'queued';
        reasonFamily = 'phase-retry-scheduled';
        nextEligibleSeconds = nextCheckSeconds;
      }
    } else if (outcome.kind === 'TERMINAL_FAILURE') {
      executionStatus = 'failed';
      reasonFamily = 'phase-terminal-failure';
      errorEnvelope = failure;
      nextPhaseKey = null;
      nextPhaseOrdinal = null;
      terminal = true;
    } else if (outcome.kind === 'STOPPED') {
      executionStatus = 'cancelled';
      reasonFamily = 'phase-stopped';
      errorEnvelope = failure;
      nextPhaseKey = null;
      nextPhaseOrdinal = null;
      terminal = true;
    } else {
      executionStatus = 'reconciliation-required';
      reasonFamily = 'phase-uncertain';
      errorEnvelope = failure;
      await client.query(
        `insert into execution.execution_reconciliation_cases
          (id, execution_id, attempt_id, case_type, status, reason_family,
           safe_details, detected_at, next_check_at)
         values ($1,$2,null,'phase-uncertainty','open','reconciliation-required',$3,now(),now())
         on conflict do nothing`,
        [
          randomUUID(),
          claim.executionId,
          {
            phaseAttemptId: claim.phaseAttemptId,
            phaseKey: claim.phaseKey,
            consequentialSubmit: claim.phaseKey === 'submit',
          },
        ],
      );
    }

    await client.query(
      `update execution.executions
          set status=$2,
              current_phase_key=$3,
              current_phase_ordinal=$4,
              next_phase_eligible_at=case when $5::int is null then null
                                          else now()+make_interval(secs=>$5) end,
              safe_continuation_ref=coalesce(safe_continuation_ref,$6),
              result_envelope=$7,
              error_envelope=$8,
              terminal_at=case when $9 then now() else null end,
              lock_version=lock_version+1,
              updated_at=now()
        where id=$1 and status='running'`,
      [
        claim.executionId,
        executionStatus,
        nextPhaseKey,
        nextPhaseOrdinal,
        nextEligibleSeconds,
        continuationRef ?? null,
        resultEnvelope,
        errorEnvelope,
        terminal,
      ],
    );
    await appendVideoMakerTransition(client, {
      executionId: claim.executionId,
      fromStatus: 'running',
      toStatus: executionStatus,
      reasonFamily,
      actorRef: workerId,
      traceId: claim.request.traceId,
      safeMetadata: {
        phaseAttemptId: claim.phaseAttemptId,
        phaseKey: claim.phaseKey,
        phaseOrdinal: claim.phaseOrdinal,
        attemptNumber: claim.attemptNumber,
        outcome: outcome.kind,
      },
    });
  });
}
