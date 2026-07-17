import { importJWK, SignJWT } from 'jose';
import { createAuthVerifier } from '../../src/api/auth.js';
import { FIXTURE_AUTH_ALLOWED_OWNER_APP } from '../../src/auth-fixture/constants.js';
import { mintFixtureToken } from '../../src/auth-fixture/mint.js';
import { buildFixtureAuthServer } from '../../src/auth-fixture/server.js';
import { loadConfig } from '../../src/config.js';
import { createFixtureAuthTestConfig } from '../unit/auth-fixture-helper.js';
async function signToken(fixture, options) {
    const key = await importJWK(fixture.privateJwk, fixture.algorithm);
    const token = await new SignJWT({
        owner_app: FIXTURE_AUTH_ALLOWED_OWNER_APP,
        scope: 'zx.executions.submit zx.executions.read',
        kid: fixture.keyId,
    })
        .setProtectedHeader({ alg: fixture.algorithm, kid: fixture.keyId })
        .setIssuer(options.issuer)
        .setAudience(options.audience)
        .setSubject(FIXTURE_AUTH_ALLOWED_OWNER_APP)
        .setIssuedAt(options.issuedAt)
        .setExpirationTime(options.expiresAt)
        .setJti('00000000-0000-4000-8000-000000000002')
        .sign(key);
    return token;
}
test('minted token passes the real remote-JWKS verifier path', async () => {
    const fixture = createFixtureAuthTestConfig();
    const app = buildFixtureAuthServer(fixture);
    await app.listen({ host: '127.0.0.1', port: 0 });
    const address = app.server.address();
    if (!address || typeof address === 'string')
        throw new Error('test server address unavailable');
    const verify = createAuthVerifier(loadConfig({
        ZX_NODE_ENV: 'test',
        ZX_API_AUTH_ISSUER: fixture.issuer,
        ZX_API_AUTH_AUDIENCE: fixture.audience,
        ZX_API_AUTH_JWKS_URL: `http://127.0.0.1:${address.port}/.well-known/jwks.json`,
    }));
    const minted = await mintFixtureToken({
        config: fixture,
        ownerApp: FIXTURE_AUTH_ALLOWED_OWNER_APP,
        scopes: ['zx.executions.submit', 'zx.executions.read'],
    });
    const principal = await verify(minted.token);
    expect(principal.ownerApp).toBe(FIXTURE_AUTH_ALLOWED_OWNER_APP);
    expect([...principal.scopes]).toEqual(['zx.executions.submit', 'zx.executions.read']);
    await app.close();
});
test('remote-JWKS verifier rejects wrong issuer, wrong audience, and expired tokens', async () => {
    const fixture = createFixtureAuthTestConfig();
    const app = buildFixtureAuthServer(fixture);
    await app.listen({ host: '127.0.0.1', port: 0 });
    const address = app.server.address();
    if (!address || typeof address === 'string')
        throw new Error('test server address unavailable');
    const verify = createAuthVerifier(loadConfig({
        ZX_NODE_ENV: 'test',
        ZX_API_AUTH_ISSUER: fixture.issuer,
        ZX_API_AUTH_AUDIENCE: fixture.audience,
        ZX_API_AUTH_JWKS_URL: `http://127.0.0.1:${address.port}/.well-known/jwks.json`,
    }));
    const now = Math.floor(Date.now() / 1_000);
    const wrongIssuer = await signToken(fixture, {
        issuer: 'urn:zimspace:z-x:wrong',
        audience: fixture.audience,
        issuedAt: now,
        expiresAt: now + 60,
    });
    const wrongAudience = await signToken(fixture, {
        issuer: fixture.issuer,
        audience: 'wrong-audience',
        issuedAt: now,
        expiresAt: now + 60,
    });
    const expired = await signToken(fixture, {
        issuer: fixture.issuer,
        audience: fixture.audience,
        issuedAt: now - 120,
        expiresAt: now - 60,
    });
    await expect(verify(wrongIssuer)).rejects.toThrow();
    await expect(verify(wrongAudience)).rejects.toThrow();
    await expect(verify(expired)).rejects.toThrow();
    await app.close();
});
//# sourceMappingURL=auth-fixture-remote-jwks.test.js.map