import { describe, expect, it } from 'vitest';
import {
  ExecutionRequestV1Schema,
  OPERATION_TYPES,
} from '../../src/contracts/v1/execution.js';
import { ZX_EXECUTION_V1_COMPATIBILITY_REGISTRATIONS } from '../../src/contracts/video-maker/v1/compatibility.js';
import { validRequest } from '../unit/test-request.js';

describe('zx.execution.v1 compatibility boundary', () => {
  it('preserves every accepted fixture operation without changing the legacy contract version', () => {
    for (const operationType of OPERATION_TYPES) {
      const parsed = ExecutionRequestV1Schema.parse({
        ...validRequest(operationType),
        safeScalarInputs: { fixtureScenario: 'success' },
      });
      expect(parsed.contractVersion).toBe('zx.execution.v1');
      expect(parsed.operationType).toBe(operationType);
    }
  });

  it('registers legacy operations as compatibility relationships rather than new permanent tool enums', () => {
    expect(ZX_EXECUTION_V1_COMPATIBILITY_REGISTRATIONS.map((entry) => entry.operationType)).toEqual(
      OPERATION_TYPES,
    );
    expect(
      ZX_EXECUTION_V1_COMPATIBILITY_REGISTRATIONS.every(
        (entry) => entry.relationship === 'legacy-fixture-operation',
      ),
    ).toBe(true);
  });
});
