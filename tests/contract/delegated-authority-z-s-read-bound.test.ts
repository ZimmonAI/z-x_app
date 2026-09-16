import { describe, expect, it } from 'vitest';
import { ExecutionRequestV1Schema } from '../../src/contracts/v1/execution.js';
import { validRequest } from '../unit/test-request.js';

describe('delegated authority bound for governed Z-s reads', () => {
  it('accepts an opaque capability at the Z-s 4096-byte verification bound', () => {
    const parsed = ExecutionRequestV1Schema.parse({
      ...validRequest(),
      delegatedAuthorities: [
        { name: 'input.primary.read', reference: `A${'b'.repeat(4095)}` },
      ],
    });
    expect(parsed.delegatedAuthorities[0]?.reference).toHaveLength(4096);
  });

  it('rejects authority material beyond the bounded transport limit', () => {
    const result = ExecutionRequestV1Schema.safeParse({
      ...validRequest(),
      delegatedAuthorities: [
        { name: 'input.primary.read', reference: `A${'b'.repeat(4096)}` },
      ],
    });
    expect(result.success).toBe(false);
  });
});
