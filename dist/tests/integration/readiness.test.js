import { buildServer } from '../../src/api/server.js';
import { loadConfig } from '../../src/config.js';
const verify = async () => ({ ownerApp: 'x', scopes: new Set(), payload: {} });
test('readiness fails closed while health stays alive', async () => { const a = await buildServer({ config: loadConfig({ ZX_NODE_ENV: 'test' }), verify, ready: async () => false }); expect((await a.inject('/internal/health')).statusCode).toBe(200); expect((await a.inject('/internal/readiness')).statusCode).toBe(503); await a.close(); });
//# sourceMappingURL=readiness.test.js.map