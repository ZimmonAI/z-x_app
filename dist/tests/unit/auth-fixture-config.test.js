import { loadFixtureAuthRuntimeConfig } from '../../src/auth-fixture/config.js';
import { FIXTURE_AUTH_AUDIENCE, FIXTURE_AUTH_ISSUER } from '../../src/auth-fixture/constants.js';
import { loadConfig } from '../../src/config.js';
import { createFixtureAuthTestConfig } from './auth-fixture-helper.js';
test('fixture auth configuration accepts one matching ES256 key pair', () => {
    const config = createFixtureAuthTestConfig();
    expect(config.issuer).toBe(FIXTURE_AUTH_ISSUER);
    expect(config.audience).toBe(FIXTURE_AUTH_AUDIENCE);
    expect(config.algorithm).toBe('ES256');
    expect(config.tokenTtlSeconds).toBe(300);
    expect(config.publicJwks.keys).toHaveLength(1);
    expect(config.publicJwks.keys[0]).not.toHaveProperty('d');
});
test('fixture auth configuration fails closed when required material is absent or public binding is requested', () => {
    expect(() => loadFixtureAuthRuntimeConfig(loadConfig({ ZX_NODE_ENV: 'test' }))).toThrow(/required/);
    const valid = createFixtureAuthTestConfig();
    expect(() => loadFixtureAuthRuntimeConfig(loadConfig({
        ZX_NODE_ENV: 'test',
        ZX_FIXTURE_AUTH_BIND_HOST: '0.0.0.0',
        ZX_FIXTURE_AUTH_PORT: String(valid.port),
        ZX_FIXTURE_AUTH_ISSUER: valid.issuer,
        ZX_FIXTURE_AUTH_AUDIENCE: valid.audience,
        ZX_FIXTURE_AUTH_ALGORITHM: valid.algorithm,
        ZX_FIXTURE_AUTH_KEY_ID: valid.keyId,
        ZX_FIXTURE_AUTH_PRIVATE_JWK_JSON: JSON.stringify(valid.privateJwk),
        ZX_FIXTURE_AUTH_PUBLIC_JWKS_JSON: JSON.stringify(valid.publicJwks),
        ZX_FIXTURE_AUTH_TOKEN_TTL_SECONDS: String(valid.tokenTtlSeconds),
    }))).toThrow(/loopback-only/);
});
test('fixture auth configuration rejects malformed or mismatched key material', () => {
    const valid = createFixtureAuthTestConfig();
    expect(() => loadFixtureAuthRuntimeConfig(loadConfig({
        ZX_NODE_ENV: 'test',
        ZX_FIXTURE_AUTH_BIND_HOST: valid.bindHost,
        ZX_FIXTURE_AUTH_PORT: String(valid.port),
        ZX_FIXTURE_AUTH_ISSUER: valid.issuer,
        ZX_FIXTURE_AUTH_AUDIENCE: valid.audience,
        ZX_FIXTURE_AUTH_ALGORITHM: valid.algorithm,
        ZX_FIXTURE_AUTH_KEY_ID: valid.keyId,
        ZX_FIXTURE_AUTH_PRIVATE_JWK_JSON: '{malformed',
        ZX_FIXTURE_AUTH_PUBLIC_JWKS_JSON: JSON.stringify(valid.publicJwks),
        ZX_FIXTURE_AUTH_TOKEN_TTL_SECONDS: String(valid.tokenTtlSeconds),
    }))).toThrow(/malformed/);
    const mismatched = structuredClone(valid.publicJwks);
    mismatched.keys[0].x = `${mismatched.keys[0].x}a`;
    expect(() => loadFixtureAuthRuntimeConfig(loadConfig({
        ZX_NODE_ENV: 'test',
        ZX_FIXTURE_AUTH_BIND_HOST: valid.bindHost,
        ZX_FIXTURE_AUTH_PORT: String(valid.port),
        ZX_FIXTURE_AUTH_ISSUER: valid.issuer,
        ZX_FIXTURE_AUTH_AUDIENCE: valid.audience,
        ZX_FIXTURE_AUTH_ALGORITHM: valid.algorithm,
        ZX_FIXTURE_AUTH_KEY_ID: valid.keyId,
        ZX_FIXTURE_AUTH_PRIVATE_JWK_JSON: JSON.stringify(valid.privateJwk),
        ZX_FIXTURE_AUTH_PUBLIC_JWKS_JSON: JSON.stringify(mismatched),
        ZX_FIXTURE_AUTH_TOKEN_TTL_SECONDS: String(valid.tokenTtlSeconds),
    }))).toThrow(/inconsistent|thumbprint/);
});
//# sourceMappingURL=auth-fixture-config.test.js.map