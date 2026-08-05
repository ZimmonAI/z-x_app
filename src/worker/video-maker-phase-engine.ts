import type pg from 'pg';
import {
  FixtureVideoMakerPhaseRunner,
  type VideoMakerPhaseOutcome,
  type VideoMakerPhaseRunner,
} from './video-maker-phase-runner.js';
import { acquirePhaseClaim } from './video-maker-phase-claim.js';
import { persistPhaseOutcome } from './video-maker-phase-outcome.js';

export {
  FixtureVideoMakerPhaseRunner,
  VIDEO_MAKER_EXECUTION_METHODS,
  VIDEO_MAKER_PHASES,
  type VideoMakerPhaseInvocation,
  type VideoMakerPhaseKey,
  type VideoMakerPhaseOutcome,
  type VideoMakerPhaseOutcomeKind,
  type VideoMakerPhaseRunner,
} from './video-maker-phase-runner.js';
export { recoverExpiredVideoMakerPhaseLeases } from './video-maker-phase-recovery.js';

export async function runNextVideoMakerPhase(
  pool: pg.Pool,
  workerId: string,
  leaseSeconds = 60,
  runner: VideoMakerPhaseRunner = new FixtureVideoMakerPhaseRunner(),
  signal = new AbortController().signal,
): Promise<boolean> {
  const claim = await acquirePhaseClaim(pool, workerId, leaseSeconds);
  if (!claim) return false;

  let leaseLost = false;
  const heartbeatMilliseconds = Math.max(1_000, Math.floor((leaseSeconds * 1_000) / 3));
  const heartbeat = setInterval(() => {
    void pool
      .query(
        `update execution.execution_phase_attempts
            set lease_expires_at=now()+make_interval(secs=>$3)
          where id=$1 and lease_token=$2 and status='running' and lease_expires_at>now()`,
        [claim.phaseAttemptId, claim.leaseToken, leaseSeconds],
      )
      .then((result) => {
        if (!result.rowCount) leaseLost = true;
      })
      .catch(() => {
        leaseLost = true;
      });
  }, heartbeatMilliseconds);
  heartbeat.unref();

  let outcome: VideoMakerPhaseOutcome;
  try {
    outcome = await runner.invoke({
      executionId: claim.executionId,
      phaseKey: claim.phaseKey,
      phaseOrdinal: claim.phaseOrdinal,
      attemptNumber: claim.attemptNumber,
      request: claim.request,
      ...(claim.safeContinuationRef
        ? { safeContinuationRef: claim.safeContinuationRef }
        : {}),
      signal,
    });
  } catch (error) {
    outcome = {
      kind: claim.phaseKey === 'submit' ? 'UNCERTAIN' : 'RETRYABLE_FAILURE',
      failure: {
        contractVersion: 'zx.video-maker.failure.v1',
        code:
          claim.phaseKey === 'submit'
            ? 'ZX_VM_SUBMIT_EXCEPTION_UNCERTAIN'
            : 'ZX_VM_PHASE_EXCEPTION',
        message: 'bounded phase runner failed safely',
        retryable: claim.phaseKey !== 'submit',
        phaseKey: claim.phaseKey,
        attemptNumber: claim.attemptNumber,
        traceId: claim.request.traceId,
      },
      evidence: {
        exceptionType: error instanceof Error ? error.name : 'unknown',
      },
    };
  } finally {
    clearInterval(heartbeat);
  }

  if (leaseLost) {
    throw new Error('video-maker phase lease was lost during invocation');
  }
  await persistPhaseOutcome(pool, claim, workerId, outcome);
  return true;
}
