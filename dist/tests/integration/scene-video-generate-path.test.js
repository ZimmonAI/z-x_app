import { AutoHubFixtureV1 } from '../../fixtures/v1/auto-hub.js';
import { ZAccountFixtureV1 } from '../../fixtures/v1/z-account.js';
import { ZProviderFixtureV1 } from '../../fixtures/v1/z-provider.js';
import { ZStorageFixtureV1 } from '../../fixtures/v1/z-s.js';
import { executeFixturePath } from '../../src/worker/lifecycle.js';
import { validRequest } from '../unit/test-request.js';
test('scene_video.generate.v1 dispatches and stores validated video', async () => {
    const request = {
        ...validRequest('scene_video.generate.v1'),
        safeScalarInputs: { prompt: 'slow camera move', fixtureScenario: 'success' },
        frozenInputResources: [{ resourceId: 'image-1', kind: 'start-image' }],
        requestedOutputType: 'video/mp4',
    };
    const result = await executeFixturePath(request, '00000000-0000-4000-8000-000000000001', {
        routes: new ZProviderFixtureV1(),
        capacity: new ZAccountFixtureV1(),
        autoHub: new AutoHubFixtureV1(),
        storage: new ZStorageFixtureV1(),
    });
    expect(result.media?.mimeType).toBe('video/mp4');
    expect(result.media?.durationSeconds).toBeGreaterThan(0);
});
//# sourceMappingURL=scene-video-generate-path.test.js.map