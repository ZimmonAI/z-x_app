import { ZProviderFixtureV1 } from '../../fixtures/v1/z-provider.js';
const c = new ZProviderFixtureV1(), s = new AbortController().signal;
test('Z-Provider fixture success and safe failures', async () => { expect((await c.resolveAndValidateRoute({ operation: 'image.generate.v1', routeLocks: {} }, s)).adapterId).toBe('image-generate-v1'); for (const fixtureScenario of ['route-not-found', 'route-deactivated', 'invalid-parameters'])
    await expect(c.resolveAndValidateRoute({ operation: 'image.generate.v1', routeLocks: {}, fixtureScenario }, s)).rejects.toThrow(); });
//# sourceMappingURL=z-provider-fixture-v1.test.js.map