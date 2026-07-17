import { getAdapter, listAdapters } from '../../src/adapters/registry.js';
test('allowlists exactly four adapters and rejects unknown binding', () => {
    expect(listAdapters().map((adapter) => `${adapter.id}@${adapter.version}`)).toEqual([
        'image-prompt-prepare-v1@1.0.0',
        'image-generate-v1@1.0.0',
        'scene-video-prompt-prepare-v1@1.0.0',
        'scene-video-generate-v1@1.0.0',
    ]);
    expect(() => getAdapter('image.generate.v1', 'bad', '1.0.0')).toThrow(/allowlisted/);
});
test('production invocation modes remain disabled without an owner contract gate', () => {
    expect(() => getAdapter('image.generate.v1', 'image-generate-v1', '1.0.0', 'auto-hub')).toThrow(/production adapter contract is disabled/);
    expect(getAdapter('image.generate.v1', 'image-generate-v1', '1.0.0', 'auto-hub', true).id).toBe('image-generate-v1');
});
//# sourceMappingURL=adapter-registry.test.js.map