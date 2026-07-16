import { SafeExecutionError } from '../contracts/v1/error.js';
import type { ExecutionAdapter } from './types.js';
import { dispatchAndStoreMedia, requiredScalarString } from './types.js';

export const sceneVideoGenerateAdapter: ExecutionAdapter = {
  operation: 'scene_video.generate.v1',
  id: 'scene-video-generate-v1',
  version: '1.0.0',
  async execute(context) {
    requiredScalarString(context.request, 'prompt');
    const startImage = context.request.frozenInputResources.find((resource) =>
      resource.kind.toLowerCase().includes('image'),
    );
    if (!startImage) {
      throw new SafeExecutionError({
        family: 'invalid-owner-request',
        code: 'ZX_START_IMAGE_REQUIRED',
        message: 'scene-video generation requires a frozen start image',
        retryable: false,
        traceId: context.request.traceId,
      });
    }
    return dispatchAndStoreMedia(context, 'video');
  },
};
