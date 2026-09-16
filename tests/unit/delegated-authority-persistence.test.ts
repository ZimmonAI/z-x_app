import type pg from 'pg';
import { describe, expect, it, vi } from 'vitest';
import { ExecutionRequestV1Schema } from '../../src/contracts/v1/execution.js';
import { ExecutionsRepository } from '../../src/persistence/repositories/executions.js';
import { validRequest } from './test-request.js';

describe('delegated authority persistence', () => {
  it('freezes delegated authority references inside the immutable request envelope', async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rowCount: 0, rows: [] })
      .mockResolvedValueOnce({ rowCount: 1, rows: [] })
      .mockResolvedValueOnce({ rowCount: 1, rows: [] });
    const repository = new ExecutionsRepository({ query } as unknown as pg.Pool);
    const request = ExecutionRequestV1Schema.parse({
      ...validRequest(),
      delegatedAuthorities: [
        { name: 'input.primary.read', reference: 'zsauth_read_01HZX8R3Q5' },
        { name: 'output.primary.write', reference: 'zsauth_write_01HZX8R3Q6' },
      ],
    });

    const result = await repository.submit(request);

    expect(result.kind).toBe('created');
    const requestInsert = query.mock.calls[1];
    expect(requestInsert?.[0]).toContain('insert into execution.execution_requests');
    expect(requestInsert?.[1]?.[8]).toEqual(request);
    expect(requestInsert?.[1]?.[8].delegatedAuthorities).toEqual(request.delegatedAuthorities);
  });
});
