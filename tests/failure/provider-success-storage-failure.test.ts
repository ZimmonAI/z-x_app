import { ZStorageFixtureV1 } from '../../fixtures/v1/z-s.js';

test('storage failure retains safe non-URL provider reference for storage-only retry', async () => {
  const client = new ZStorageFixtureV1();
  const signal = new AbortController().signal;

  await expect(
    client.completeOrIngestOutput(
      {
        executionId: '1f19e087-aebe-4b07-b6e4-39a4fc38311f',
        attemptId: 'cd833802-0da8-4a09-a2b8-731af51cc6dd',
        authorizationRef: 'a',
        safeProviderOutputRef: 'safe-ref',
        mimeType: 'image/png',
        fixtureScenario: 'storage-failure',
      },
      signal,
    ),
  ).rejects.toThrow(/storage/);
});
