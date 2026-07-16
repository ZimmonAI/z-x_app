import type { ExecutionAdapter } from './types.js';
import { dispatchAndStoreMedia, requiredScalarString } from './types.js';

export const imageGenerateAdapter: ExecutionAdapter = {
  operation: 'image.generate.v1',
  id: 'image-generate-v1',
  version: '1.0.0',
  async execute(context) {
    requiredScalarString(context.request, 'prompt');
    return dispatchAndStoreMedia(context, 'image');
  },
};
