import { SafeExecutionError } from '../contracts/v1/error.js';
import { validatePrompt } from '../validation/output.js';
import type { ExecutionAdapter } from './types.js';
import { requiredScalarString } from './types.js';

export const sceneVideoPromptPrepareAdapter: ExecutionAdapter = {
  operation: 'scene_video_prompt.prepare.v1',
  id: 'scene-video-prompt-prepare-v1',
  version: '1.0.0',
  async execute({ request }) {
    const scene = requiredScalarString(request, 'scene');
    const selectedImage = request.frozenInputResources.find((resource) =>
      resource.kind.toLowerCase().includes('image'),
    );
    if (!selectedImage) {
      throw new SafeExecutionError({
        family: 'invalid-owner-request',
        code: 'ZX_SELECTED_IMAGE_REQUIRED',
        message: 'scene-video prompt preparation requires frozen selected-image lineage',
        retryable: false,
        traceId: request.traceId,
      });
    }
    const expectedResourceId = request.correlation.selectedImageResourceId;
    if (expectedResourceId && expectedResourceId !== selectedImage.resourceId) {
      throw new SafeExecutionError({
        family: 'invalid-owner-request',
        code: 'ZX_SELECTED_IMAGE_LINEAGE_MISMATCH',
        message: 'selected-image lineage does not match the frozen correlation',
        retryable: false,
        traceId: request.traceId,
      });
    }
    return {
      promptText: validatePrompt(`Animate image ${selectedImage.resourceId}: ${scene}`),
    };
  },
};
