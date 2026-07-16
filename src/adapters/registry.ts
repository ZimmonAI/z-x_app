import { assertAllowlistedBinding } from '../security/allowlist.js';
import type { OperationType } from '../contracts/v1/execution.js';
import { imageGenerateAdapter } from './image-generate.js';
import { imagePromptPrepareAdapter } from './image-prompt-prepare.js';
import { sceneVideoGenerateAdapter } from './scene-video-generate.js';
import { sceneVideoPromptPrepareAdapter } from './scene-video-prompt-prepare.js';
import type { ExecutionAdapter } from './types.js';

const registry = new Map<OperationType, ExecutionAdapter>([
  [imagePromptPrepareAdapter.operation, imagePromptPrepareAdapter],
  [imageGenerateAdapter.operation, imageGenerateAdapter],
  [sceneVideoPromptPrepareAdapter.operation, sceneVideoPromptPrepareAdapter],
  [sceneVideoGenerateAdapter.operation, sceneVideoGenerateAdapter],
]);

export function getAdapter(
  operation: OperationType,
  id?: string,
  version?: string,
  mode = 'fixture',
  productionContractEnabled = false,
): ExecutionAdapter {
  const adapter = registry.get(operation);
  if (!adapter) throw new Error('unknown operation');
  assertAllowlistedBinding(operation, id ?? adapter.id, version ?? adapter.version, mode);
  if (mode !== 'fixture' && !productionContractEnabled) {
    throw new Error('production adapter contract is disabled');
  }
  return adapter;
}

export function listAdapters(): ExecutionAdapter[] {
  return [...registry.values()];
}
