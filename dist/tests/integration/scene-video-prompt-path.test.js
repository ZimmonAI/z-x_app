import { AutoHubFixtureV1 } from '../../fixtures/v1/auto-hub.js';
import { ZAccountFixtureV1 } from '../../fixtures/v1/z-account.js';
import { ZProviderFixtureV1 } from '../../fixtures/v1/z-provider.js';
import { ZStorageFixtureV1 } from '../../fixtures/v1/z-s.js';
import { executeFixturePath } from '../../src/worker/lifecycle.js';
import { validRequest } from '../unit/test-request.js';
test('scene_video_prompt.prepare.v1 preserves selected-image lineage', async () => {
    const request = {
        ...validRequest('scene_video_prompt.prepare.v1'),
        frozenInputResources: [{ resourceId: 'image-1', kind: 'selected-image' }],
        correlation: { selectedImageResourceId: 'image-1' },
    };
    const result = await executeFixturePath(request, '00000000-0000-4000-8000-000000000001', {
        routes: new ZProviderFixtureV1(),
        capacity: new ZAccountFixtureV1(),
        autoHub: new AutoHubFixtureV1(),
        storage: new ZStorageFixtureV1(),
    });
    expect(result.promptText).toContain('image-1');
});
//# sourceMappingURL=scene-video-prompt-path.test.js.map