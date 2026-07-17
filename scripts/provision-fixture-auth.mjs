import { createHash, generateKeyPairSync } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

const FIXTURE_AUTH_ISSUER = 'urn:zimspace:z-x:fixture-auth';
const FIXTURE_AUTH_AUDIENCE = 'z-x-execution-runner';
const FIXTURE_AUTH_ALGORITHM = 'ES256';
const FIXTURE_AUTH_TOKEN_TTL_SECONDS = '300';
const FIXTURE_AUTH_ENVIRONMENT_KEYS = [
  'ZX_FIXTURE_AUTH_BIND_HOST',
  'ZX_FIXTURE_AUTH_PORT',
  'ZX_FIXTURE_AUTH_ISSUER',
  'ZX_FIXTURE_AUTH_AUDIENCE',
  'ZX_FIXTURE_AUTH_ALGORITHM',
  'ZX_FIXTURE_AUTH_KEY_ID',
  'ZX_FIXTURE_AUTH_PRIVATE_JWK_JSON',
  'ZX_FIXTURE_AUTH_PUBLIC_JWKS_JSON',
  'ZX_FIXTURE_AUTH_TOKEN_TTL_SECONDS',
];

function parseArguments(arguments_) {
  const values = { replace: false, bindHost: '127.0.0.1' };
  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index];
    if (argument === '--replace') {
      values.replace = true;
      continue;
    }
    const next = arguments_[index + 1];
    if (!next || next.startsWith('--')) throw new Error(`${argument} requires a value`);
    if (argument === '--env-file') values.envFile = next;
    else if (argument === '--port') values.port = next;
    else if (argument === '--bind-host') values.bindHost = next;
    else throw new Error(`unknown argument: ${argument}`);
    index += 1;
  }
  if (!values.envFile) throw new Error('--env-file required');
  if (!values.port || !/^\d+$/u.test(values.port)) throw new Error('--port required');
  const port = Number(values.port);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) throw new Error('--port invalid');
  if (values.bindHost !== '127.0.0.1' && values.bindHost !== '::1') {
    throw new Error('--bind-host must be loopback-only');
  }
  return { ...values, port: String(port) };
}

function calculateKeyId(publicJwk) {
  const canonical = JSON.stringify({
    crv: publicJwk.crv,
    kty: publicJwk.kty,
    x: publicJwk.x,
    y: publicJwk.y,
  });
  return createHash('sha256').update(canonical).digest('base64url');
}

function formatEnvironment(environment) {
  const environmentKeys = Object.keys(environment);
  if (
    environmentKeys.length !== FIXTURE_AUTH_ENVIRONMENT_KEYS.length ||
    environmentKeys.some((key) => !FIXTURE_AUTH_ENVIRONMENT_KEYS.includes(key))
  ) {
    throw new Error('fixture auth environment must contain exactly nine variables');
  }
  return `${FIXTURE_AUTH_ENVIRONMENT_KEYS.map((key) => {
    const value = environment[key];
    if (typeof value !== 'string' || /[\r\n]/u.test(value)) {
      throw new Error(`${key} must be a single-line string`);
    }
    return `${key}=${value}`;
  }).join('\n')}\n`;
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const rawPublicJwk = publicKey.export({ format: 'jwk' });
  const rawPrivateJwk = privateKey.export({ format: 'jwk' });
  const keyId = calculateKeyId(rawPublicJwk);
  const publicJwk = {
    ...rawPublicJwk,
    kid: keyId,
    alg: FIXTURE_AUTH_ALGORITHM,
    use: 'sig',
  };
  const privateJwk = {
    ...rawPrivateJwk,
    kid: keyId,
    alg: FIXTURE_AUTH_ALGORITHM,
    use: 'sig',
  };
  const publicJwks = { keys: [publicJwk] };
  const outputPath = resolve(options.envFile);
  await mkdir(dirname(outputPath), { recursive: true, mode: 0o700 });
  await writeFile(
    outputPath,
    formatEnvironment({
      ZX_FIXTURE_AUTH_BIND_HOST: options.bindHost,
      ZX_FIXTURE_AUTH_PORT: options.port,
      ZX_FIXTURE_AUTH_ISSUER: FIXTURE_AUTH_ISSUER,
      ZX_FIXTURE_AUTH_AUDIENCE: FIXTURE_AUTH_AUDIENCE,
      ZX_FIXTURE_AUTH_ALGORITHM: FIXTURE_AUTH_ALGORITHM,
      ZX_FIXTURE_AUTH_KEY_ID: keyId,
      ZX_FIXTURE_AUTH_PRIVATE_JWK_JSON: JSON.stringify(privateJwk),
      ZX_FIXTURE_AUTH_PUBLIC_JWKS_JSON: JSON.stringify(publicJwks),
      ZX_FIXTURE_AUTH_TOKEN_TTL_SECONDS: FIXTURE_AUTH_TOKEN_TTL_SECONDS,
    }),
    { encoding: 'utf8', mode: 0o600, flag: options.replace ? 'w' : 'wx' },
  );
  process.stdout.write(`fixture auth env written: ${outputPath}\n`);
  process.stdout.write(`algorithm: ${FIXTURE_AUTH_ALGORITHM}\n`);
  process.stdout.write(`public key fingerprint: ${keyId}\n`);
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : 'unknown failure';
  process.stderr.write(`fixture auth provisioning failed: ${message}\n`);
  process.exitCode = 1;
});
