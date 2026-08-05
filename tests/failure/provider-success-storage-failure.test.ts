import { randomUUID } from 'node:crypto';
import { ZStorageFixtureV1 } from '../../fixtures/v1/z-s.js';

test('storage failure retains safe non-URL provider reference for storage-only retry', async () => {
  const client = new ZStorageFixtureV1();
  const signal = new AbortController().signal;
  await expect(
    client.completeOrIngestOutput(
      {
        executionId: randomUUID(),
        attemptId: randomUUID(),
        authorizationRef: 'a',
        safeProviderOutputRef: 'safe-ref',
        mimeType: 'image/png',
        fixtureScenario: 'storage-failure',
      },
      signal,
    ),
  ).rejects.toThrow(/storage/);
});
