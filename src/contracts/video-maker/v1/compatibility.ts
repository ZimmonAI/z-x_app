import type { OperationType } from '../../v1/execution.js';
import type { VideoMakerExecutionRequestV1 } from './execution.js';

export interface ZxExecutionV1CompatibilityRegistration {
  operationType: OperationType;
  relationship: 'legacy-fixture-operation';
  relatedToolKey: VideoMakerExecutionRequestV1['toolKey'];
  executionRole: 'prompt-preparation' | 'generated-output';
}

/**
 * Documentation-only compatibility registrations. They preserve the four accepted
 * zx.execution.v1 fixture operations without treating them as the permanent tool catalog.
 */
export const ZX_EXECUTION_V1_COMPATIBILITY_REGISTRATIONS = [
  {
    operationType: 'image_prompt.prepare.v1',
    relationship: 'legacy-fixture-operation',
    relatedToolKey: 'consumer-gpt',
    executionRole: 'prompt-preparation',
  },
  {
    operationType: 'image.generate.v1',
    relationship: 'legacy-fixture-operation',
    relatedToolKey: 'consumer-gpt',
    executionRole: 'generated-output',
  },
  {
    operationType: 'scene_video_prompt.prepare.v1',
    relationship: 'legacy-fixture-operation',
    relatedToolKey: 'google-flow',
    executionRole: 'prompt-preparation',
  },
  {
    operationType: 'scene_video.generate.v1',
    relationship: 'legacy-fixture-operation',
    relatedToolKey: 'google-flow',
    executionRole: 'generated-output',
  },
] as const satisfies readonly ZxExecutionV1CompatibilityRegistration[];
