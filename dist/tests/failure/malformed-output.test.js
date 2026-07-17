import { validateImage } from '../../src/validation/media.js';
test('malformed provider output is rejected', () => expect(() => validateImage({ mimeType: 'image/gif', sizeBytes: 1, width: 1, height: 1, checksumSha256: 'x', storageIdentity: 'zs://x' })).toThrow());
//# sourceMappingURL=malformed-output.test.js.map