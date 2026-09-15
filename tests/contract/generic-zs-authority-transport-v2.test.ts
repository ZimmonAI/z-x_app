import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';
import { GenericAwareExecutionService } from '../../src/api/generic-aware-execution-service.js';
import { MemoryGenericExecutionService } from '../../src/api/generic-execution-service.js';
import { executionRoutes, MemoryExecutionService } from '../../src/api/routes/executions.js';
import { ExecutionRequestV2Schema } from '../../src/contracts/v2/execution.js';
import { validRequest } from '../unit/test-request.js';

const CAPABILITY = `${'a'.repeat(96)}.${'b'.repeat(43)}`;

function request(overrides: Record<string, unknown> = {}) {
  return {
    contractVersion: 'zx.execution.v2',
    ownerApp: 'neutral-owner_app',
    ownerActionId: 'action-42',
    ownerProjectId: 'project-7',
    idempotencyKey: 'generic-idem-1',
    requestFingerprint: 'a'.repeat(64),
    executionMethodRef: 'browser-generate-v4',
    payload: {
      target_uri: 'zs://owner/object-1',
      prompt: 'Create a technical result.',
      account_id: 'acct-17',
    },
    runtimeRequirements: [{ kind: 'ACCOUNT_EXACT', valueFrom: '$.account_id' }],
    storageAccess: {
      service: 'z-s',
      audience: 'z-x_app',
      capability: CAPABILITY,
    },
    correlation: { workflow: 'neutral-proof' },
    traceId: 'trace-generic-42',
    ...overrides,
  };
}

describe('zx.execution.v2 delegated Z-s authority transport', () => {
  it('accepts one generic method, payload, runtime requirements and opaque Z-s capability', () => {
    const parsed = ExecutionRequestV2Schema.parse(request());
    expect(parsed.executionMethodRef).toBe('browser-generate-v4');
    expect(parsed.runtimeRequirements).toEqual([
      { kind: 'ACCOUNT_EXACT', valueFrom: '$.account_id' },
    ]);
    expect(parsed.storageAccess?.capability).toBe(CAPABILITY);
  });

  it('keeps the storage authority generic and rejects invalid delegated-authority wrappers', () => {
    expect(() =>
      ExecutionRequestV2Schema.parse(
        request({ storageAccess: { service: 'other', audience: 'z-x_app', capability: CAPABILITY } }),
      ),
    ).toThrow();
    expect(() =>
      ExecutionRequestV2Schema.parse(
        request({ storageAccess: { service: 'z-s', audience: 'browser', capability: CAPABILITY } }),
      ),
    ).toThrow();
    expect(() =>
      ExecutionRequestV2Schema.parse(
        request({
          storageAccess: {
            service: 'z-s',
            audience: 'z-x_app',
            capability: CAPABILITY,
            bucket: 'forbidden-routing-detail',
          },
        }),
      ),
    ).toThrow();
    expect(() =>
      ExecutionRequestV2Schema.parse(
        request({
          storageAccess: { service: 'z-s', audience: 'z-x_app', capability: 'Bearer secret' },
        }),
      ),
    ).toThrow();
  });

  it('freezes the exact capability but never returns it through owner-visible execution truth', async () => {
    const target = new MemoryGenericExecutionService();
    const accepted = await target.submit('neutral-owner_app', request());
    const executionId = (accepted.record as unknown as { executionId: string }).executionId;
    const frozen = target.inspectFrozenRequestForTest('neutral-owner_app', executionId);

    expect(frozen?.storageAccess?.capability).toBe(CAPABILITY);
    expect(JSON.stringify(accepted.record)).not.toContain(CAPABILITY);
    expect(JSON.stringify(await target.get('neutral-owner_app', executionId))).not.toContain(CAPABILITY);
    expect(await target.get('other-owner_app', executionId)).toBeNull();
  });

  it('binds idempotency to the complete frozen request, including protected authority', async () => {
    const target = new MemoryGenericExecutionService();
    const first = await target.submit('neutral-owner_app', request());
    const duplicate = await target.submit('neutral-owner_app', request());

    expect(duplicate.code).toBe(200);
    expect((duplicate.record as unknown as { executionId: string }).executionId).toBe(
      (first.record as unknown as { executionId: string }).executionId,
    );

    await expect(
      target.submit(
        'neutral-owner_app',
        request({
          storageAccess: {
            service: 'z-s',
            audience: 'z-x_app',
            capability: `${'c'.repeat(96)}.${'d'.repeat(43)}`,
          },
        }),
      ),
    ).rejects.toMatchObject({ statusCode: 409 });
  });

  it('enforces authenticated owner identity without owner-specific code branches', async () => {
    const target = new MemoryGenericExecutionService();
    await expect(target.submit('different-owner_app', request())).rejects.toMatchObject({
      statusCode: 403,
    });

    const ownerA = await target.submit(
      'owner-a_app',
      request({ ownerApp: 'owner-a_app', idempotencyKey: 'same-key' }),
    );
    const ownerB = await target.submit(
      'owner-b_app',
      request({ ownerApp: 'owner-b_app', idempotencyKey: 'same-key' }),
    );
    expect((ownerA.record as unknown as { executionId: string }).executionId).not.toBe(
      (ownerB.record as unknown as { executionId: string }).executionId,
    );
  });

  it('uses the existing execution route family while preserving legacy v1 dispatch', async () => {
    const generic = new MemoryGenericExecutionService();
    const combined = new GenericAwareExecutionService(new MemoryExecutionService(), generic);
    const app = Fastify();
    const verify = async (token: string) => ({
      ownerApp: token,
      scopes: new Set([
        'zx.executions.submit',
        'zx.executions.read',
        'zx.executions.cancel',
        'zx.executions.retry',
        'zx.executions.reconcile',
      ]),
      payload: {},
    });
    await executionRoutes(app, { service: combined, verify });

    const submitted = await app.inject({
      method: 'POST',
      url: '/internal/v1/executions',
      headers: { authorization: 'Bearer neutral-owner_app' },
      payload: request(),
    });
    expect(submitted.statusCode).toBe(202);
    expect(submitted.body).not.toContain(CAPABILITY);
    const executionId = (submitted.json() as { executionId: string }).executionId;

    const read = await app.inject({
      method: 'GET',
      url: `/internal/v1/executions/${executionId}`,
      headers: { authorization: 'Bearer neutral-owner_app' },
    });
    expect(read.statusCode).toBe(200);
    expect(read.body).not.toContain(CAPABILITY);

    const hidden = await app.inject({
      method: 'GET',
      url: `/internal/v1/executions/${executionId}`,
      headers: { authorization: 'Bearer other-owner_app' },
    });
    expect(hidden.statusCode).toBe(404);

    const legacyRequest = validRequest();
    const legacy = await app.inject({
      method: 'POST',
      url: '/internal/v1/executions',
      headers: { authorization: `Bearer ${legacyRequest.ownerApp}` },
      payload: legacyRequest,
    });
    expect(legacy.statusCode).toBe(202);
    expect(legacy.json()).toMatchObject({
      ownerApp: legacyRequest.ownerApp,
      status: 'accepted',
    });

    await app.close();
  });
});
