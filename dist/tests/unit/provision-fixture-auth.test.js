import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadFixtureAuthRuntimeConfig } from '../../src/auth-fixture/config.js';
import { calculateFixtureKeyId, FIXTURE_AUTH_ALLOWED_OWNER_APP, FIXTURE_AUTH_ALLOWED_SCOPES, } from '../../src/auth-fixture/constants.js';
import { mintFixtureToken } from '../../src/auth-fixture/mint.js';
import { loadConfig } from '../../src/config.js';
import { parseStatusCompatibleEnvironmentFile } from './auth-fixture-helper.js';
const DOCUMENTED_PROVISION_COMMAND = 'node -- scripts/provision-fixture-auth.mjs --env-file <exact-path> --port <registered-port> --bind-host 127.0.0.1';
const EXPECTED_FIXTURE_AUTH_KEYS = [
    'ZX_FIXTURE_AUTH_ALGORITHM',
    'ZX_FIXTURE_AUTH_AUDIENCE',
    'ZX_FIXTURE_AUTH_BIND_HOST',
    'ZX_FIXTURE_AUTH_ISSUER',
    'ZX_FIXTURE_AUTH_KEY_ID',
    'ZX_FIXTURE_AUTH_PORT',
    'ZX_FIXTURE_AUTH_PRIVATE_JWK_JSON',
    'ZX_FIXTURE_AUTH_PUBLIC_JWKS_JSON',
    'ZX_FIXTURE_AUTH_TOKEN_TTL_SECONDS',
];
function runProvision(arguments_) {
    return new Promise((resolve) => {
        const child = spawn(process.execPath, ['--', 'scripts/provision-fixture-auth.mjs', ...arguments_], {
            cwd: process.cwd(),
            stdio: ['ignore', 'pipe', 'pipe'],
        });
        let stdout = '';
        let stderr = '';
        child.stdout.setEncoding('utf8').on('data', (chunk) => {
            stdout += chunk;
        });
        child.stderr.setEncoding('utf8').on('data', (chunk) => {
            stderr += chunk;
        });
        child.on('close', (code) => resolve({ code, stdout, stderr }));
    });
}
test('documented fixture auth provisioning syntax matches the Node 22-safe invocation', async () => {
    const [readme, operations] = await Promise.all([
        readFile('README.md', 'utf8'),
        readFile('docs/operations.md', 'utf8'),
    ]);
    for (const document of [readme, operations]) {
        expect(document).toContain(DOCUMENTED_PROVISION_COMMAND);
        expect(document).not.toContain('node scripts/provision-fixture-auth.mjs --env-file <exact-path>');
    }
});
test('provision utility emits Status-compatible fixture auth configuration without disclosure', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'zx-fixture-auth-'));
    try {
        const envFile = join(directory, 'fixture.env');
        const result = await runProvision([
            '--env-file',
            envFile,
            '--port',
            '12345',
            '--bind-host',
            '127.0.0.1',
        ]);
        expect(result.code).toBe(0);
        const contents = await readFile(envFile, 'utf8');
        expect(contents).not.toContain('\r');
        const physicalLines = contents.split('\n');
        expect(physicalLines.at(-1)).toBe('');
        physicalLines.pop();
        expect(physicalLines).toHaveLength(9);
        expect(physicalLines
            .map((line) => line.slice(0, line.indexOf('=')))
            .sort()).toEqual(EXPECTED_FIXTURE_AUTH_KEYS);
        const escapedQuotedValue = parseStatusCompatibleEnvironmentFile(String.raw `EXAMPLE="{\"kty\":\"EC\"}"`);
        expect(escapedQuotedValue.EXAMPLE).toBe(String.raw `{\"kty\":\"EC\"}`);
        const environment = parseStatusCompatibleEnvironmentFile(contents);
        expect(Object.keys(environment).sort()).toEqual(EXPECTED_FIXTURE_AUTH_KEYS);
        const privateJwkJson = environment.ZX_FIXTURE_AUTH_PRIVATE_JWK_JSON ?? '';
        const publicJwksJson = environment.ZX_FIXTURE_AUTH_PUBLIC_JWKS_JSON ?? '';
        for (const rawJson of [privateJwkJson, publicJwksJson]) {
            expect(rawJson.startsWith('{')).toBe(true);
            expect(rawJson.endsWith('}')).toBe(true);
            expect(rawJson).not.toMatch(/^["']/u);
            expect(rawJson).not.toContain('\\"');
        }
        const config = loadFixtureAuthRuntimeConfig(loadConfig({ ZX_NODE_ENV: 'test', ...environment }));
        const publicJwk = config.publicJwks.keys[0];
        expect(config.bindHost).toBe('127.0.0.1');
        expect(config.privateJwk.crv).toBe('P-256');
        expect(publicJwk.crv).toBe('P-256');
        expect(config.privateJwk.x).toBe(publicJwk.x);
        expect(config.privateJwk.y).toBe(publicJwk.y);
        expect(config.privateJwk.kid).toBe(config.keyId);
        expect(publicJwk.kid).toBe(config.keyId);
        expect(calculateFixtureKeyId(publicJwk)).toBe(config.keyId);
        const minted = await mintFixtureToken({
            config,
            ownerApp: FIXTURE_AUTH_ALLOWED_OWNER_APP,
            scopes: [FIXTURE_AUTH_ALLOWED_SCOPES[0]],
            ttlSeconds: 60,
            now: new Date('2026-01-01T00:00:00.000Z'),
            jti: 'status-env-compatibility-regression',
        });
        expect(minted.token.split('.')).toHaveLength(3);
        const processOutput = `${result.stdout}${result.stderr}`;
        expect(processOutput).not.toContain(config.privateJwk.d);
        expect(processOutput).not.toContain(privateJwkJson);
        expect(processOutput).not.toContain(publicJwksJson);
        expect(processOutput).not.toContain(minted.token);
        expect(result.stdout).toContain('algorithm: ES256');
        const second = await runProvision([
            '--env-file',
            envFile,
            '--port',
            '12345',
            '--bind-host',
            '127.0.0.1',
        ]);
        expect(second.code).not.toBe(0);
        expect(second.stderr).toMatch(/failed/u);
        const nonLoopback = await runProvision([
            '--env-file',
            join(directory, 'forbidden.env'),
            '--port',
            '12345',
            '--bind-host',
            '0.0.0.0',
        ]);
        expect(nonLoopback.code).not.toBe(0);
        expect(nonLoopback.stderr).toMatch(/loopback-only/u);
    }
    finally {
        await rm(directory, { recursive: true, force: true });
    }
});
//# sourceMappingURL=provision-fixture-auth.test.js.map