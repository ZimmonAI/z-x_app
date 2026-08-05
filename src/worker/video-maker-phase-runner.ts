import type { VideoMakerExecutionRequestV1 } from '../contracts/video-maker/v1/execution.js';

export const VIDEO_MAKER_PHASES = [
  'submit',
  'check-completion',
  'collect-and-store-result',
] as const;

export type VideoMakerPhaseKey = (typeof VIDEO_MAKER_PHASES)[number];
export type VideoMakerPhaseOutcomeKind =
  | 'DONE'
  | 'WAITING'
  | 'RETRYABLE_FAILURE'
  | 'TERMINAL_FAILURE'
  | 'STOPPED'
  | 'UNCERTAIN';

export const VIDEO_MAKER_EXECUTION_METHODS = {
  'consumer-gpt': {
    methodKey: 'video-maker-consumer-gpt-fixture-v1',
    phases: VIDEO_MAKER_PHASES,
  },
  'google-flow': {
    methodKey: 'video-maker-google-flow-fixture-v1',
    phases: VIDEO_MAKER_PHASES,
  },
} as const;

export interface VideoMakerPhaseOutcome {
  kind: VideoMakerPhaseOutcomeKind;
  nextCheckSeconds?: number;
  runnerExecutionRef?: string;
  safeContinuationRef?: string;
  outputAuthorizationRef?: string;
  safeProviderOutputRef?: string;
  result?: Record<string, unknown>;
  failure?: Record<string, unknown>;
  evidence?: Record<string, unknown>;
}

export interface VideoMakerPhaseInvocation {
  executionId: string;
  phaseKey: VideoMakerPhaseKey;
  phaseOrdinal: number;
  attemptNumber: number;
  request: VideoMakerExecutionRequestV1;
  safeContinuationRef?: string;
  signal: AbortSignal;
}

export interface VideoMakerPhaseRunner {
  invoke(input: VideoMakerPhaseInvocation): Promise<VideoMakerPhaseOutcome>;
}

function fixtureScenario(request: VideoMakerExecutionRequestV1): string {
  return request.correlation.fixtureScenario ?? 'immediate-success';
}

function safeFailure(
  input: VideoMakerPhaseInvocation,
  code: string,
  message: string,
  retryable: boolean,
): Record<string, unknown> {
  return {
    contractVersion: 'zx.video-maker.failure.v1',
    code,
    message,
    retryable,
    phaseKey: input.phaseKey,
    attemptNumber: input.attemptNumber,
    traceId: input.request.traceId,
  };
}

export function fixtureVideoMakerResult(input: VideoMakerPhaseInvocation): Record<string, unknown> {
  return {
    contractVersion: 'zx.video-maker.result.v1',
    executionId: input.executionId,
    toolKey: input.request.toolKey,
    outputs: input.request.ownerStorageAccess.outputTargets.map((target, index) => ({
      pendingResourceId: target.pendingResourceId,
      storageObjectId: `stored-${input.executionId}-${index + 1}`,
      kind: input.request.requestedOutput.kind,
      mimeType: input.request.requestedOutput.mimeType,
    })),
  };
}

export class FixtureVideoMakerPhaseRunner implements VideoMakerPhaseRunner {
  async invoke(input: VideoMakerPhaseInvocation): Promise<VideoMakerPhaseOutcome> {
    if (input.signal.aborted) {
      return {
        kind: input.phaseKey === 'submit' ? 'UNCERTAIN' : 'STOPPED',
        failure: safeFailure(
          input,
          input.phaseKey === 'submit' ? 'ZX_VM_SUBMIT_INTERRUPTED' : 'ZX_VM_PHASE_STOPPED',
          'bounded fixture phase was interrupted',
          false,
        ),
        evidence: { interrupted: true },
      };
    }

    const scenario = fixtureScenario(input.request);
    const runnerExecutionRef = `runner-${input.executionId}`;
    const safeContinuationRef =
      input.safeContinuationRef ?? `continuation-${input.executionId}`;

    if (input.phaseKey === 'submit') {
      if (scenario === 'uncertain-submit') {
        return {
          kind: 'UNCERTAIN',
          runnerExecutionRef,
          safeContinuationRef,
          failure: safeFailure(
            input,
            'ZX_VM_SUBMIT_UNCERTAIN',
            'fixture submit outcome is uncertain',
            false,
          ),
          evidence: { consequentialDispatchMayHaveOccurred: true },
        };
      }
      if (scenario === 'stopped') {
        return {
          kind: 'STOPPED',
          failure: safeFailure(input, 'ZX_VM_STOPPED', 'fixture execution stopped', false),
        };
      }
      return {
        kind: 'DONE',
        runnerExecutionRef,
        safeContinuationRef,
        evidence: { submitted: true },
      };
    }

    if (input.phaseKey === 'check-completion') {
      if (scenario === 'waiting-then-success' && input.attemptNumber === 1) {
        return {
          kind: 'WAITING',
          nextCheckSeconds: 1,
          runnerExecutionRef,
          safeContinuationRef,
          evidence: { providerState: 'pending' },
        };
      }
      if (scenario === 'retryable-then-success' && input.attemptNumber === 1) {
        return {
          kind: 'RETRYABLE_FAILURE',
          runnerExecutionRef,
          safeContinuationRef,
          failure: safeFailure(
            input,
            'ZX_VM_FIXTURE_RETRYABLE',
            'fixture phase failed retryably',
            true,
          ),
        };
      }
      if (scenario === 'terminal-failure') {
        return {
          kind: 'TERMINAL_FAILURE',
          runnerExecutionRef,
          safeContinuationRef,
          failure: safeFailure(
            input,
            'ZX_VM_FIXTURE_TERMINAL',
            'fixture phase failed terminally',
            false,
          ),
        };
      }
      return {
        kind: 'DONE',
        runnerExecutionRef,
        safeContinuationRef,
        evidence: { providerState: 'complete' },
      };
    }

    return {
      kind: 'DONE',
      runnerExecutionRef,
      safeContinuationRef,
      outputAuthorizationRef:
        input.request.ownerStorageAccess.outputTargets[0]?.outputWriteGrantRef,
      safeProviderOutputRef: `provider-output-${input.executionId}`,
      result: fixtureVideoMakerResult(input),
      evidence: { collectedOutputCount: input.request.requestedOutput.count },
    };
  }
}
