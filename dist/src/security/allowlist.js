export const ADAPTER_ALLOWLIST = {
    'image_prompt.prepare.v1': { id: 'image-prompt-prepare-v1', version: '1.0.0' },
    'image.generate.v1': { id: 'image-generate-v1', version: '1.0.0' },
    'scene_video_prompt.prepare.v1': { id: 'scene-video-prompt-prepare-v1', version: '1.0.0' },
    'scene_video.generate.v1': { id: 'scene-video-generate-v1', version: '1.0.0' }
};
export function assertAllowlistedBinding(operation, id, version, mode) { const b = ADAPTER_ALLOWLIST[operation]; if (b.id !== id || b.version !== version || !['fixture', 'auto-hub', 'http-json', 'cli'].includes(mode))
    throw new Error('binding not allowlisted'); }
export function rejectArbitraryExecutionInput(input) { if (Object.values(input).some(Boolean))
    throw new Error('arbitrary executable, path, URL, and command input is prohibited'); }
//# sourceMappingURL=allowlist.js.map