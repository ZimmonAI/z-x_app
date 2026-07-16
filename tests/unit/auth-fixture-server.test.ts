import { FIXTURE_AUTH_HEALTH_PATH, FIXTURE_AUTH_JWKS_PATH } from '../../src/auth-fixture/constants.js';
import { buildFixtureAuthServer } from '../../src/auth-fixture/server.js';
import { createFixtureAuthTestConfig } from './auth-fixture-helper.js';

test('fixture auth serves only safe health and public JWKS responses', async () => {
  const config = createFixtureAuthTestConfig();
  const app = buildFixtureAuthServer(config);
  const health = await app.inject({ method: 'GET', url: FIXTURE_AUTH_HEALTH_PATH });
  expect(health.statusCode).toBe(200);
  expect(health.json()).toEqual({ status: 'alive' });

  const jwks = await app.inject({ method: 'GET', url: FIXTURE_AUTH_JWKS_PATH });
  expect(jwks.statusCode).toBe(200);
  expect(jwks.json()).toEqual(config.publicJwks);
  const serialized = `${health.body}\n${jwks.body}`;
  expect(serialized).not.toContain(config.privateJwk.d);
  expect(serialized).not.toContain('ZX_FIXTURE_AUTH_PRIVATE_JWK_JSON');

  const missing = await app.inject({ method: 'GET', url: '/not-config' });
  expect(missing.statusCode).toBe(404);
  expect(missing.json()).toEqual({ error: 'not found' });
  expect(missing.body).not.toContain('stack');
  await app.close();
});
