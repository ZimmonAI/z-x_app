import { ExecutionRequestV1Schema } from '../../src/contracts/v1/execution.js';
import { validRequest } from '../unit/test-request.js';

const validStorageOutput = {
  contractVersion: 'zx.storage-output.v1',
  mode: 'post-run-ingest',
  artifactKind: 'image',
  acceptedMimeTypes: ['image/png'],
  storageProfileRef: 'zs-profile:fixture.default',
  maxBytes: 1048576,
};

test('validates old fixture requests without storage output', () => {
  expect(ExecutionRequestV1Schema.parse(validRequest()).contractVersion).toBe(
    'zx.execution.v1',
  );
});

test('validates post-run-ingest storage output request', () => {
  const parsed = ExecutionRequestV1Schema.parse({
    ...validRequest('image.generate.v1'),
    requestedOutputType: 'image/png',
    storageOutput: validStorageOutput,
  });

  expect(parsed.storageOutput).toEqual(validStorageOutput);
});

test.each([
  ['malformed mime', { acceptedMimeTypes: ['image png'] }],
  ['duplicate mime', { acceptedMimeTypes: ['image/png', 'image/png'] }],
  ['missing requested output', { acceptedMimeTypes: ['image/jpeg'] }],
  ['artifact mismatch', { artifactKind: 'video' }],
  ['provider coordinate profile', { storageProfileRef: 'provider:auto-hub' }],
  ['url profile', { storageProfileRef: 'https://storage.example/output' }],
  ['path profile', { storageProfileRef: 'C:\\tmp\\output' }],
  ['unsafe max bytes', { maxBytes: 0 }],
])('rejects invalid storage output request: %s', (_name, override) => {
  expect(() =>
    ExecutionRequestV1Schema.parse({
      ...validRequest('image.generate.v1'),
      requestedOutputType: 'image/png',
      storageOutput: { ...validStorageOutput, ...override },
    }),
  ).toThrow();
});

test('rejects scene-video request with image storage output', () => {
  expect(() =>
    ExecutionRequestV1Schema.parse({
      ...validRequest('scene_video.generate.v1'),
      requestedOutputType: 'video/mp4',
      storageOutput: validStorageOutput,
    }),
  ).toThrow();
});
