import { generateKeyPairSync } from 'node:crypto';
import { loadFixtureAuthRuntimeConfig } from '../../src/auth-fixture/config.js';
import {
  calculateFixtureKeyId,
  FIXTURE_AUTH_ALGORITHM,
  FIXTURE_AUTH_AUDIENCE,
  FIXTURE_AUTH_ISSUER,
} from '../../src/auth-fixture/constants.js';
import { loadConfig } from '../../src/config.js';

export function parseStatusCompatibleEnvironmentFile(contents: string): Record<string, string> {
  const environment: Record<string, string> = {};
  for (const rawLine of contents.split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const separatorIndex = line.indexOf('=');
    if (separatorIndex === -1) continue;
    const key = line.substring(0, separatorIndex).trim();
    let value = line.substring(separatorIndex + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.substring(1, value.length - 1);
    }
    if (key) environment[key] = value;
  }
  return environment;
}

export function createFixtureAuthTestConfig() {
  const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const rawPublicJwk = publicKey.export({ format: 'jwk' });
  const rawPrivateJwk = privateKey.export({ format: 'jwk' });
  if (!rawPublicJwk.x || !rawPublicJwk.y || !rawPrivateJwk.d) throw new Error('test key incomplete');
  const keyId = calculateFixtureKeyId({
    kty: 'EC',
    crv: 'P-256',
    x: rawPublicJwk.x,
    y: rawPublicJwk.y,
  });
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
  return loadFixtureAuthRuntimeConfig(
    loadConfig({
      ZX_NODE_ENV: 'test',
      ZX_FIXTURE_AUTH_BIND_HOST: '127.0.0.1',
      ZX_FIXTURE_AUTH_PORT: '1',
      ZX_FIXTURE_AUTH_ISSUER: FIXTURE_AUTH_ISSUER,
      ZX_FIXTURE_AUTH_AUDIENCE: FIXTURE_AUTH_AUDIENCE,
      ZX_FIXTURE_AUTH_ALGORITHM: FIXTURE_AUTH_ALGORITHM,
      ZX_FIXTURE_AUTH_KEY_ID: keyId,
      ZX_FIXTURE_AUTH_PRIVATE_JWK_JSON: JSON.stringify(privateJwk),
      ZX_FIXTURE_AUTH_PUBLIC_JWKS_JSON: JSON.stringify({ keys: [publicJwk] }),
      ZX_FIXTURE_AUTH_TOKEN_TTL_SECONDS: '300',
    }),
  );
}
