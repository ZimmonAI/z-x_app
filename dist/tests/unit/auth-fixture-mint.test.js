import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { decodeJwt, decodeProtectedHeader } from 'jose';
import { FIXTURE_AUTH_ALLOWED_OWNER_APP } from '../../src/auth-fixture/constants.js';
import { mintFixtureToken, parseMintArguments, runMintCommand } from '../../src/auth-fixture/mint.js';
import { createFixtureAuthTestConfig } from './auth-fixture-helper.js';
test('fixture mint represents owner, scopes, claims, and kid exactly', async () => {
    const config = createFixtureAuthTestConfig();
    const minted = await mintFixtureToken({
        config,
        ownerApp: FIXTURE_AUTH_ALLOWED_OWNER_APP,
        scopes: ['zx.executions.submit', 'zx.executions.read'],
        ttlSeconds: 300,
        jti: '00000000-0000-4000-8000-000000000001',
        now: new Date('2026-07-16T00:00:00.000Z'),
    });
    const payload = decodeJwt(minted.token);
    const protectedHeader = decodeProtectedHeader(minted.token);
    expect(payload.owner_app).toBe(FIXTURE_AUTH_ALLOWED_OWNER_APP);
    expect(payload.scope).toBe('zx.executions.submit zx.executions.read');
    expect(payload.iss).toBe(config.issuer);
    expect(payload.aud).toBe(config.audience);
    expect(payload.sub).toBe(FIXTURE_AUTH_ALLOWED_OWNER_APP);
    expect(payload.jti).toBe('00000000-0000-4000-8000-000000000001');
    expect(payload.kid).toBe(config.keyId);
    expect(protectedHeader).toMatchObject({ alg: 'ES256', kid: config.keyId, typ: 'JWT' });
    expect(Number(payload.exp) - Number(payload.iat)).toBe(300);
});
test('fixture mint fails closed for owner, scope, TTL, and missing CLI input', async () => {
    const config = createFixtureAuthTestConfig();
    await expect(mintFixtureToken({ config, ownerApp: '', scopes: ['zx.executions.submit'] })).rejects.toThrow(/owner app/);
    await expect(mintFixtureToken({
        config,
        ownerApp: FIXTURE_AUTH_ALLOWED_OWNER_APP,
        scopes: ['zx.executions.unknown'],
    })).rejects.toThrow(/scope not allowed/);
    await expect(mintFixtureToken({
        config,
        ownerApp: FIXTURE_AUTH_ALLOWED_OWNER_APP,
        scopes: ['zx.executions.submit'],
        ttlSeconds: 301,
    })).rejects.toThrow(/300/);
    expect(() => parseMintArguments(['--env-file', 'x'])).toThrow(/owner-app/);
});
test('mint command writes the token only to the requested output file', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'zx-fixture-mint-'));
    const config = createFixtureAuthTestConfig();
    const envFile = join(directory, 'fixture.env');
    const outputFile = join(directory, 'token.txt');
    const environment = {
        ZX_FIXTURE_AUTH_BIND_HOST: config.bindHost,
        ZX_FIXTURE_AUTH_PORT: String(config.port),
        ZX_FIXTURE_AUTH_ISSUER: config.issuer,
        ZX_FIXTURE_AUTH_AUDIENCE: config.audience,
        ZX_FIXTURE_AUTH_ALGORITHM: config.algorithm,
        ZX_FIXTURE_AUTH_KEY_ID: config.keyId,
        ZX_FIXTURE_AUTH_PRIVATE_JWK_JSON: JSON.stringify(config.privateJwk),
        ZX_FIXTURE_AUTH_PUBLIC_JWKS_JSON: JSON.stringify(config.publicJwks),
        ZX_FIXTURE_AUTH_TOKEN_TTL_SECONDS: String(config.tokenTtlSeconds),
    };
    await writeFile(envFile, `${Object.entries(environment)
        .map(([key, value]) => `${key}=${JSON.stringify(value)}`)
        .join('\n')}\n`);
    let stdout = '';
    const originalWrite = process.stdout.write;
    process.stdout.write = ((chunk) => {
        stdout += String(chunk);
        return true;
    });
    try {
        await runMintCommand([
            '--env-file',
            envFile,
            '--owner-app',
            FIXTURE_AUTH_ALLOWED_OWNER_APP,
            '--scope',
            'zx.executions.submit',
            '--output-file',
            outputFile,
        ]);
        const token = (await readFile(outputFile, 'utf8')).trim();
        expect(token.split('.')).toHaveLength(3);
        expect(stdout).not.toContain(token);
        expect(stdout).not.toContain(config.privateJwk.d);
    }
    finally {
        process.stdout.write = originalWrite;
        await rm(directory, { recursive: true, force: true });
    }
});
//# sourceMappingURL=auth-fixture-mint.test.js.map