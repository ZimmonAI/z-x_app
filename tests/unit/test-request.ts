import { createHash } from 'node:crypto';
import type { OperationType } from '../../src/contracts/v1/execution.js';

function requestedOutputType(operation: OperationType): string {
  switch (operation) {
    case 'image.generate.v1':
      return 'image/png';
    case 'scene_video.generate.v1':
      return 'video/mp4';
    default:
      return 'text/plain';
  }
}

export function validRequest(operation: OperationType = 'image_prompt.prepare.v1') {
  const base = {
    contractVersion: 'zx.execution.v1',
    ownerApp: 'video-maker',
    ownerActionId: 'action-1',
    idempotencyKey: 'key-1',
    operationType: operation,
    frozenInputResources: [],
    safeScalarInputs: { scene: 'sunrise', fixtureScenario: 'success' },
    routeLocks: {
      provider: 'AUTO',
      model: 'AUTO',
      tool: 'AUTO',
      software: 'AUTO',
      runMode: 'AUTO',
    },
    requestedOutputType: requestedOutputType(operation),
    validationExpectations: {},
    timeoutPolicy: { timeoutSeconds: 900 },
    retryPolicy: { maxAttempts: 3 },
    priority: 5,
    correlation: {},
    traceId: 'trace-1',
  };
  return {
    ...base,
    requestFingerprint: createHash('sha256').update(JSON.stringify(base)).digest('hex'),
  };
}
