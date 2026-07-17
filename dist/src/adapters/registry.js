import { assertAllowlistedBinding } from '../security/allowlist.js';
import { imageGenerateAdapter } from './image-generate.js';
import { imagePromptPrepareAdapter } from './image-prompt-prepare.js';
import { sceneVideoGenerateAdapter } from './scene-video-generate.js';
import { sceneVideoPromptPrepareAdapter } from './scene-video-prompt-prepare.js';
const registry = new Map([
    [imagePromptPrepareAdapter.operation, imagePromptPrepareAdapter],
    [imageGenerateAdapter.operation, imageGenerateAdapter],
    [sceneVideoPromptPrepareAdapter.operation, sceneVideoPromptPrepareAdapter],
    [sceneVideoGenerateAdapter.operation, sceneVideoGenerateAdapter],
]);
export function getAdapter(operation, id, version, mode = 'fixture', productionContractEnabled = false) {
    const adapter = registry.get(operation);
    if (!adapter)
        throw new Error('unknown operation');
    assertAllowlistedBinding(operation, id ?? adapter.id, version ?? adapter.version, mode);
    if (mode !== 'fixture' && !productionContractEnabled) {
        throw new Error('production adapter contract is disabled');
    }
    return adapter;
}
export function listAdapters() {
    return [...registry.values()];
}
//# sourceMappingURL=registry.js.map