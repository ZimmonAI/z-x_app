import { buildServer } from '../../src/api/server.js';
import { loadConfig } from '../../src/config.js';
import { validRequest } from '../unit/test-request.js';
const verify = async () => ({
    ownerApp: 'video-maker',
    scopes: new Set([
        'zx.executions.submit',
        'zx.executions.read',
        'zx.executions.cancel',
        'zx.executions.retry',
        'zx.executions.reconcile',
    ]),
    payload: {},
});
test('authenticated API submit/read/cancel and owner isolation semantics', async () => {
    const app = await buildServer({
        config: loadConfig({ ZX_NODE_ENV: 'test' }),
        verify,
    });
    const headers = { authorization: 'Bearer fixture' };
    const submitted = await app.inject({
        method: 'POST',
        url: '/internal/v1/executions',
        headers,
        payload: validRequest(),
    });
    expect(submitted.statusCode).toBe(202);
    const id = submitted.json().id;
    expect((await app.inject({ method: 'GET', url: `/internal/v1/executions/${id}`, headers }))
        .statusCode).toBe(200);
    const cancelled = await app.inject({
        method: 'POST',
        url: `/internal/v1/executions/${id}/cancel`,
        headers,
    });
    expect(cancelled.statusCode).toBe(202);
    expect(cancelled.json().cancellationAccepted).toBe(true);
    expect((await app.inject({
        method: 'POST',
        url: `/internal/v1/executions/${id}/cancel`,
        headers,
    })).statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: `/internal/v1/executions/${id}` })).statusCode).toBe(401);
    await app.close();
});
//# sourceMappingURL=api-auth-routes.test.js.map