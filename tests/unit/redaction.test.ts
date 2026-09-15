import { REDACTED, redact } from '../../src/security/redaction.js';

test('recursively redacts keys and credential patterns', () => {
  const signedCapability = `${'a'.repeat(96)}.${'b'.repeat(43)}`;
  const out = redact({
    authorization: 'Bearer abc',
    nested: { databaseUrl: 'postgresql://u:p@h/db', note: 'safe' },
    arr: ['eyJabc.def.ghi', signedCapability],
  }) as {
    authorization: string;
    nested: { databaseUrl: string; note: string };
    arr: string[];
  };

  expect(out.authorization).toBe(REDACTED);
  expect(out.nested.databaseUrl).toBe(REDACTED);
  expect(out.nested.note).toBe('safe');
  expect(out.arr[0]).toBe(REDACTED);
  expect(out.arr[1]).toBe(REDACTED);
});
