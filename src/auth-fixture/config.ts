import type { Config } from '../config.js';
import {
  calculateFixtureKeyId,
  FIXTURE_AUTH_ALGORITHM,
  FIXTURE_AUTH_AUDIENCE,
  FIXTURE_AUTH_DEFAULT_TOKEN_TTL_SECONDS,
  FIXTURE_AUTH_ISSUER,
  type FixturePrivateJwk,
  type FixturePublicJwk,
  type FixturePublicJwks,
} from './constants.js';

export interface FixtureAuthRuntimeConfig {
  bindHost: string;
  port: number;
  issuer: typeof FIXTURE_AUTH_ISSUER;
  audience: typeof FIXTURE_AUTH_AUDIENCE;
  algorithm: typeof FIXTURE_AUTH_ALGORITHM;
  keyId: string;
  privateJwk: FixturePrivateJwk;
  publicJwks: FixturePublicJwks;
  tokenTtlSeconds: typeof FIXTURE_AUTH_DEFAULT_TOKEN_TTL_SECONDS;
}

function requireString(value: unknown, name: string): string {
  if (typeof value !== 'string' || value.length === 0) throw new Error(`${name} required`);
  return value;
}

function parseObject(value: string, name: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(value);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error(`${name} must be a JSON object`);
    }
    return parsed as Record<string, unknown>;
  } catch {
    throw new Error(`${name} malformed`);
  }
}

function validatePublicJwk(value: unknown, keyId: string): FixturePublicJwk {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('fixture public JWK malformed');
  }
  const jwk = value as Record<string, unknown>;
  if (
    jwk.kty !== 'EC' ||
    jwk.crv !== 'P-256' ||
    typeof jwk.x !== 'string' ||
    typeof jwk.y !== 'string' ||
    jwk.kid !== keyId ||
    jwk.alg !== FIXTURE_AUTH_ALGORITHM ||
    jwk.use !== 'sig' ||
    'd' in jwk
  ) {
    throw new Error('fixture public JWK inconsistent');
  }
  const publicJwk = jwk as unknown as FixturePublicJwk;
  if (calculateFixtureKeyId(publicJwk) !== keyId) {
    throw new Error('fixture key ID does not match the RFC 7638 thumbprint');
  }
  return publicJwk;
}

function validatePrivateJwk(value: string, keyId: string, publicJwk: FixturePublicJwk): FixturePrivateJwk {
  const jwk = parseObject(value, 'ZX_FIXTURE_AUTH_PRIVATE_JWK_JSON');
  if (
    jwk.kty !== 'EC' ||
    jwk.crv !== 'P-256' ||
    jwk.x !== publicJwk.x ||
    jwk.y !== publicJwk.y ||
    typeof jwk.d !== 'string' ||
    jwk.d.length === 0 ||
    jwk.kid !== keyId ||
    jwk.alg !== FIXTURE_AUTH_ALGORITHM ||
    jwk.use !== 'sig'
  ) {
    throw new Error('fixture private JWK inconsistent');
  }
  return jwk as unknown as FixturePrivateJwk;
}

export function loadFixtureAuthRuntimeConfig(config: Config): FixtureAuthRuntimeConfig {
  const bindHost = requireString(config.ZX_FIXTURE_AUTH_BIND_HOST, 'ZX_FIXTURE_AUTH_BIND_HOST');
  if (bindHost !== '127.0.0.1' && bindHost !== '::1') {
    throw new Error('ZX_FIXTURE_AUTH_BIND_HOST must be loopback-only');
  }
  const port = config.ZX_FIXTURE_AUTH_PORT;
  if (typeof port !== 'number' || !Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error('ZX_FIXTURE_AUTH_PORT required');
  }
  if (config.ZX_FIXTURE_AUTH_ISSUER !== FIXTURE_AUTH_ISSUER) {
    throw new Error('ZX_FIXTURE_AUTH_ISSUER must match the fixture issuer');
  }
  if (config.ZX_FIXTURE_AUTH_AUDIENCE !== FIXTURE_AUTH_AUDIENCE) {
    throw new Error('ZX_FIXTURE_AUTH_AUDIENCE must match the fixture audience');
  }
  if (config.ZX_FIXTURE_AUTH_ALGORITHM !== FIXTURE_AUTH_ALGORITHM) {
    throw new Error('ZX_FIXTURE_AUTH_ALGORITHM must be ES256');
  }
  if (config.ZX_FIXTURE_AUTH_TOKEN_TTL_SECONDS !== FIXTURE_AUTH_DEFAULT_TOKEN_TTL_SECONDS) {
    throw new Error('ZX_FIXTURE_AUTH_TOKEN_TTL_SECONDS must be 300');
  }
  const keyId = requireString(config.ZX_FIXTURE_AUTH_KEY_ID, 'ZX_FIXTURE_AUTH_KEY_ID');
  const publicJwksValue = parseObject(
    requireString(config.ZX_FIXTURE_AUTH_PUBLIC_JWKS_JSON, 'ZX_FIXTURE_AUTH_PUBLIC_JWKS_JSON'),
    'ZX_FIXTURE_AUTH_PUBLIC_JWKS_JSON',
  );
  if (!Array.isArray(publicJwksValue.keys) || publicJwksValue.keys.length !== 1) {
    throw new Error('fixture public JWKS must contain exactly one key');
  }
  const publicJwk = validatePublicJwk(publicJwksValue.keys[0], keyId);
  const privateJwk = validatePrivateJwk(
    requireString(config.ZX_FIXTURE_AUTH_PRIVATE_JWK_JSON, 'ZX_FIXTURE_AUTH_PRIVATE_JWK_JSON'),
    keyId,
    publicJwk,
  );
  return {
    bindHost,
    port,
    issuer: FIXTURE_AUTH_ISSUER,
    audience: FIXTURE_AUTH_AUDIENCE,
    algorithm: FIXTURE_AUTH_ALGORITHM,
    keyId,
    privateJwk,
    publicJwks: { keys: [publicJwk] },
    tokenTtlSeconds: FIXTURE_AUTH_DEFAULT_TOKEN_TTL_SECONDS,
  };
}
