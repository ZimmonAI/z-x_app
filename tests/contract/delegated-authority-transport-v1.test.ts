import { describe, expect, it } from 'vitest';
import {
  ExecutionRequestV1Schema,
  getDelegatedAuthorityReference,
} from '../../src/contracts/v1/execution.js';
import { validRequest } from '../unit/test-request.js';

describe('delegated authority transport', () => {
  it('accepts and preserves exact opaque authority references on a generic execution', () => {
    const parsed = ExecutionRequestV1Schema.parse({
      ...validRequest(),
      delegatedAuthorities: [
        { name: 'input.primary.read', reference: 'zsauth_read_01HZX8R3Q5' },
        { name: 'output.primary.write', reference: 'zsauth_write_01HZX8R3Q6' },
      ],
    });

    expect(parsed.delegatedAuthorities).toEqual([
      { name: 'input.primary.read', reference: 'zsauth_read_01HZX8R3Q5' },
      { name: 'output.primary.write', reference: 'zsauth_write_01HZX8R3Q6' },
    ]);
    expect(getDelegatedAuthorityReference(parsed, 'output.primary.write')).toBe(
      'zsauth_write_01HZX8R3Q6',
    );
  });

  it('defaults to no delegated authority and does not make it mandatory', () => {
    const parsed = ExecutionRequestV1Schema.parse(validRequest());
    expect(parsed.delegatedAuthorities).toEqual([]);
  });

  it('rejects duplicate authority names so execution code receives one exact reference per name', () => {
    const result = ExecutionRequestV1Schema.safeParse({
      ...validRequest(),
      delegatedAuthorities: [
        { name: 'output.primary.write', reference: 'zsauth_write_a' },
        { name: 'output.primary.write', reference: 'zsauth_write_b' },
      ],
    });
    expect(result.success).toBe(false);
  });

  it.each([
    'https://storage.example.invalid/signed/object',
    's3:bucket-key',
    'bucket-prod',
    'prefix-owner-project',
    'accessKey123',
    'secretKey123',
    'credentialRef',
    'signedUrlRef',
    'bearer token',
    'token=abc',
  ])('rejects raw provider or bearer-like authority material: %s', (reference) => {
    const result = ExecutionRequestV1Schema.safeParse({
      ...validRequest(),
      delegatedAuthorities: [{ name: 'output.primary.write', reference }],
    });
    expect(result.success).toBe(false);
  });

  it('does not admit destination-selection fields inside delegated authority entries', () => {
    const result = ExecutionRequestV1Schema.safeParse({
      ...validRequest(),
      delegatedAuthorities: [
        {
          name: 'output.primary.write',
          reference: 'zsauth_write_01HZX8R3Q6',
          bucket: 'owner-bucket',
        },
      ],
    });
    expect(result.success).toBe(false);
  });
});
