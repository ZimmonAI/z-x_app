import { AutoHubFixtureV1 } from '../../fixtures/v1/auto-hub.js';
import { ZAccountFixtureV1 } from '../../fixtures/v1/z-account.js';
import { ZProviderFixtureV1 } from '../../fixtures/v1/z-provider.js';
import { ZStorageFixtureV1 } from '../../fixtures/v1/z-s.js';
import { executeFixturePath } from '../../src/worker/lifecycle.js';
import { validRequest } from '../unit/test-request.js';

test('image.generate.v1 dispatches and returns stable Z-s identity', async () => {
  const request = {
    ...validRequest('image.generate.v1'),
    safeScalarInputs: { prompt: 'cinematic sunrise' },
    requestedOutputType: 'image/png',
  };
  const result = await executeFixturePath(
    request as never,
    '00000000-0000-4000-8000-000000000001',
    {
      routes: new ZProviderFixtureV1(),
      capacity: new ZAccountFixtureV1(),
      autoHub: new AutoHubFixtureV1(),
      storage: new ZStorageFixtureV1(),
    },
  );
  expect(result.externalRunRef).toBeTruthy();
  expect(result.media?.storageIdentity).toMatch(/^zs:\/\//);
});
