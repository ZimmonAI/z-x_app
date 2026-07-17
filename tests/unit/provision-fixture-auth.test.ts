import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { decodeJwt } from 'jose';
import { loadFixtureAuthRuntimeConfig } from '../../src/auth-fixture/config.js';
import { FIXTURE_AUTH_ALLOWED_OWNER_APP } from '../../src/auth-fixture/constants.js';
import { mintFixtureToken } from '../../src/auth-fixture/mint.js';
import { loadConfig } from '../../src/config.js';
import { loadStatusCompatibleEnvironment } from './status-env-helper.js';

const EXPECTED_VARIABLES = [
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

function runProvision(arguments_: string[]) {
  return new Promise<{ code: number | null; stdout: string; stderr: string }>((resolve) => {
    const child = spawn(process.execPath, ['scripts/provision-fixture-auth.mjs', ...arguments_], {
      cwd: process.cwd(),
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8').on('data', (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.setEncoding('utf8').on('data', (chunk: string) => {
      stderr += chunk;
    });
    child.on('close', (code) => resolve({ code, stdout, stderr }));
  });
}

test('provision utility writes Status-compatible fixture auth env and preserves bounded minting', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'zx-fixture-auth-'));
  try {
    const envFile = join(directory, 'fixture.env');
    const commandArguments = [
      '--env-file',
      envFile,
      '--port',
      '12345',
      '--bind-host',
      '127.0.0.1',
    ];
    const result = await runProvision(commandArguments);
    expect(result.code).toBe(0);

    const content = await readFile(envFile, 'utf8');
    expect(content.endsWith('\n')).toBe(true);
    expect(content).not.toContain('\r');
    const physicalLines = content.slice(0, -1).split('\n');
    expect(physicalLines).toHaveLength(9);
    expect(physicalLines.every((line) => line.indexOf('=') > 0)).toBe(true);

    const environment = loadStatusCompatibleEnvironment(content);
    expect(Object.keys(environment).sort()).toEqual(EXPECTED_VARIABLES);

    const privateLine = physicalLines.find((line) =>
      line.startsWith('ZX_FIXTURE_AUTH_PRIVATE_JWK_JSON='),
    );
    const publicLine = physicalLines.find((line) =>
      line.startsWith('ZX_FIXTURE_AUTH_PUBLIC_JWKS_JSON='),
    );
    expect(privateLine).toMatch(/^ZX_FIXTURE_AUTH_PRIVATE_JWK_JSON=\{/u);
    expect(publicLine).toMatch(/^ZX_FIXTURE_AUTH_PUBLIC_JWKS_JSON=\{/u);
    expect(privateLine).not.toMatch(/^ZX_FIXTURE_AUTH_PRIVATE_JWK_JSON=["']/u);
    expect(publicLine).not.toMatch(/^ZX_FIXTURE_AUTH_PUBLIC_JWKS_JSON=["']/u);
    expect(privateLine).not.toMatch(/\\"/u);
    expect(publicLine).not.toMatch(/\\"/u);

    const runtimeConfig = loadFixtureAuthRuntimeConfig(loadConfig(environment));
    const publicJwk = runtimeConfig.publicJwks.keys[0];
    expect(runtimeConfig.bindHost).toBe('127.0.0.1');
    expect(runtimeConfig.port).toBe(12345);
    expect(runtimeConfig.privateJwk).toMatchObject({
      kty: 'EC',
      crv: 'P-256',
      x: publicJwk.x,
      y: publicJwk.y,
      kid: runtimeConfig.keyId,
    });
    expect(publicJwk.kid).toBe(runtimeConfig.keyId);
    expect('d' in publicJwk).toBe(false);

    const minted = await mintFixtureToken({
      config: runtimeConfig,
      ownerApp: FIXTURE_AUTH_ALLOWED_OWNER_APP,
      scopes: ['zx.executions.submit'],
      ttlSeconds: 300,
      jti: '00000000-0000-4000-8000-000000000005',
      now: new Date('2026-07-17T00:00:00.000Z'),
    });
    const payload = decodeJwt(minted.token);
    expect(minted.token.split('.')).toHaveLength(3);
    expect(payload.iss).toBe(runtimeConfig.issuer);
    expect(payload.aud).toBe(runtimeConfig.audience);
    expect(Number(payload.exp) - Number(payload.iat)).toBe(300);

    const processOutput = `${result.stdout}${result.stderr}`;
    expect(processOutput).not.toContain(runtimeConfig.privateJwk.d);
    expect(processOutput).not.toContain(environment.ZX_FIXTURE_AUTH_PRIVATE_JWK_JSON);
    expect(processOutput).not.toContain(environment.ZX_FIXTURE_AUTH_PUBLIC_JWKS_JSON);
    expect(processOutput).not.toContain(minted.token);
    expect(processOutput).not.toContain(content.trim());
    expect(result.stdout).toContain('algorithm: ES256');

    const second = await runProvision(commandArguments);
    expect(second.code).not.toBe(0);
    expect(second.stderr).toMatch(/failed/u);
    expect(await readFile(envFile, 'utf8')).toBe(content);

    const replacement = await runProvision([...commandArguments, '--replace']);
    expect(replacement.code).toBe(0);
    const replacementEnvironment = loadStatusCompatibleEnvironment(await readFile(envFile, 'utf8'));
    expect(() => loadFixtureAuthRuntimeConfig(loadConfig(replacementEnvironment))).not.toThrow();
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('provision utility rejects CR and LF injection without creating an env file', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'zx-fixture-auth-injection-'));
  try {
    for (const [name, separator] of [
      ['lf', '\n'],
      ['cr', '\r'],
    ] as const) {
      const envFile = join(directory, `${name}.env`);
      const result = await runProvision([
        '--env-file',
        envFile,
        '--port',
        '12345',
        '--bind-host',
        `127.0.0.1${separator}ZX_UNEXPECTED=1`,
      ]);
      expect(result.code).not.toBe(0);
      expect(result.stderr).toMatch(/loopback-only/u);
      expect(`${result.stdout}${result.stderr}`).not.toContain('ZX_UNEXPECTED=1');
      await expect(readFile(envFile, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
