import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { parseEnvironmentFile } from '../../src/auth-fixture/env-file.js';

function runProvision(arguments_: string[]) {
  return new Promise<{ code: number | null; stdout: string; stderr: string }>((resolve) => {
    const child = spawn(process.execPath, ['--', 'scripts/provision-fixture-auth.mjs', ...arguments_], {
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

test('provision utility writes only the nine fixture variables and prints no private value', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'zx-fixture-auth-'));
  try {
    const envFile = join(directory, 'fixture.env');
    const result = await runProvision(['--env-file', envFile, '--port', '12345']);
    expect(result.code).toBe(0);
    const environment = parseEnvironmentFile(await readFile(envFile, 'utf8'));
    expect(Object.keys(environment).sort()).toEqual([
      'ZX_FIXTURE_AUTH_ALGORITHM',
      'ZX_FIXTURE_AUTH_AUDIENCE',
      'ZX_FIXTURE_AUTH_BIND_HOST',
      'ZX_FIXTURE_AUTH_ISSUER',
      'ZX_FIXTURE_AUTH_KEY_ID',
      'ZX_FIXTURE_AUTH_PORT',
      'ZX_FIXTURE_AUTH_PRIVATE_JWK_JSON',
      'ZX_FIXTURE_AUTH_PUBLIC_JWKS_JSON',
      'ZX_FIXTURE_AUTH_TOKEN_TTL_SECONDS',
    ]);
    const privateJwk = JSON.parse(environment.ZX_FIXTURE_AUTH_PRIVATE_JWK_JSON ?? '{}') as {
      d?: string;
    };
    const publicJwks = JSON.parse(environment.ZX_FIXTURE_AUTH_PUBLIC_JWKS_JSON ?? '{}') as {
      keys?: Array<{ d?: string }>;
    };
    expect(privateJwk.d).toBeTruthy();
    expect(publicJwks.keys?.[0]?.d).toBeUndefined();
    expect(`${result.stdout}${result.stderr}`).not.toContain(privateJwk.d);
    expect(result.stdout).toContain('algorithm: ES256');

    const second = await runProvision(['--env-file', envFile, '--port', '12345']);
    expect(second.code).not.toBe(0);
    expect(second.stderr).toMatch(/failed/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
