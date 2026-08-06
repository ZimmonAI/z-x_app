import { ZStorageFixtureV1 } from '../../fixtures/v1/z-s.js';
const client = new ZStorageFixtureV1();
const signal = new AbortController().signal;
test('Z-s fixture returns stable identity and storage failure', async () => {
    const authorization = await client.createOutputAuthorization({
        executionId: 'e',
        attemptId: 'a1',
        mode: 'post-run-ingest',
        artifactKind: 'image',
        acceptedMimeTypes: ['image/png'],
        mimeType: 'image/png',
    }, signal);
    expect(authorization.authorizationRef).toBe('outauth_e_a1');
    const completion = {
        executionId: 'e',
        attemptId: 'a1',
        authorizationRef: authorization.authorizationRef,
        safeProviderOutputRef: 'o',
        mimeType: 'image/png',
    };
    expect((await client.completeOrIngestOutput(completion, signal)).storageIdentity).toMatch(/^zs:/);
    await expect(client.completeOrIngestOutput({ ...completion, fixtureScenario: 'storage-failure' }, signal)).rejects.toThrow();
});
//# sourceMappingURL=z-s-fixture-v1.test.js.map