import { describe, expect, it } from 'vitest';
import {
  VIDEO_MAKER_EXECUTION_CONTRACT_VERSION,
  VIDEO_MAKER_OWNER_STORAGE_ACCESS_VERSION,
  freezeVideoMakerExecutionRequestV1,
} from '../../src/contracts/video-maker/v1/execution.js';
import {
  FixtureVideoMakerPhaseRunner,
  VIDEO_MAKER_EXECUTION_METHODS,
  VIDEO_MAKER_PHASES,
} from '../../src/worker/video-maker-phase-engine.js';

function request(scenario = 'immediate-success') {
  return freezeVideoMakerExecutionRequestV1({
    contractVersion: VIDEO_MAKER_EXECUTION_CONTRACT_VERSION,
    ownerApp: 'video-maker_app',
    ownerActionId: 'action_phase_unit',
    ownerProjectId: 'project_phase_unit',
    idempotencyKey: `idempotency_${scenario}`,
    traceId: 'trace_phase_unit',
    requestMode: 'initial',
    frozenInputResources: [],
    ownerStorageAccess: {
      contractVersion: VIDEO_MAKER_OWNER_STORAGE_ACCESS_VERSION,
      outputTargets: [
        { pendingResourceId: 'pending_1', outputWriteGrantRef: 'write_grant_1' },
      ],
    },
    requestedOutput: { kind: 'text', mimeType: 'text/plain', count: 1 },
    retryPolicy: { maxAttempts: 3, backoffSeconds: 1 },
    timeoutPolicy: { executionSeconds: 900, phaseSeconds: 300 },
    priority: 5,
    correlation: { fixtureScenario: scenario },
    toolKey: 'consumer-gpt',
    toolParameters: {
      prompt: 'Generate fixture text.',
      inputResourceRoles: [],
      outputKind: 'text',
      generationSettings: {},
    },
  });
}

describe('generic video-maker phase runner', () => {
  it('registers both tools with the same three logical phases', () => {
    expect(VIDEO_MAKER_EXECUTION_METHODS['consumer-gpt'].phases).toEqual(VIDEO_MAKER_PHASES);
    expect(VIDEO_MAKER_EXECUTION_METHODS['google-flow'].phases).toEqual(VIDEO_MAKER_PHASES);
  });

  it('returns WAITING without changing the logical phase contract', async () => {
    const outcome = await new FixtureVideoMakerPhaseRunner().invoke({
      executionId: 'a26e9a5c-7375-4d73-a3b3-502be62689d6',
      phaseKey: 'check-completion',
      phaseOrdinal: 1,
      attemptNumber: 1,
      request: request('waiting-then-success'),
      safeContinuationRef: 'continuation-unit',
      signal: new AbortController().signal,
    });
    expect(outcome.kind).toBe('WAITING');
    expect(outcome.nextCheckSeconds).toBeGreaterThan(0);
  });

  it('returns UNCERTAIN for consequential submit uncertainty', async () => {
    const outcome = await new FixtureVideoMakerPhaseRunner().invoke({
      executionId: 'b48e587d-123b-4894-83ea-30ef65d4eb9d',
      phaseKey: 'submit',
      phaseOrdinal: 0,
      attemptNumber: 1,
      request: request('uncertain-submit'),
      signal: new AbortController().signal,
    });
    expect(outcome.kind).toBe('UNCERTAIN');
    expect(outcome.failure).toMatchObject({ code: 'ZX_VM_SUBMIT_UNCERTAIN' });
  });
});
