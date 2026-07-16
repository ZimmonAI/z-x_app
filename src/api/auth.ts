import { createRemoteJWKSet, jwtVerify, type JWTPayload } from 'jose';
import type { FastifyRequest } from 'fastify';
import type { Config } from '../config.js';

export interface Principal {
  ownerApp: string;
  scopes: Set<string>;
  payload: JWTPayload;
}

export type AuthVerifier = (token: string) => Promise<Principal>;

export function createAuthVerifier(config: Config): AuthVerifier {
  const issuer = config.ZX_API_AUTH_ISSUER;
  const audience = config.ZX_API_AUTH_AUDIENCE;
  const jwksUrl = config.ZX_API_AUTH_JWKS_URL;
  if (!issuer || !audience || !jwksUrl) {
    throw new Error('JWT issuer, audience, and JWKS required');
  }
  const jwks = createRemoteJWKSet(new URL(jwksUrl));
  return async (token) => {
    const { payload } = await jwtVerify(token, jwks, { issuer, audience });
    const ownerApp = String(payload.owner_app ?? '');
    const scope = typeof payload.scope === 'string' ? payload.scope.split(' ') : [];
    if (!ownerApp) throw new Error('owner_app missing');
    return { ownerApp, scopes: new Set(scope), payload };
  };
}

export async function authenticate(
  request: FastifyRequest,
  verify: AuthVerifier,
): Promise<Principal> {
  const authorization = request.headers.authorization;
  if (!authorization?.startsWith('Bearer ')) {
    throw Object.assign(new Error('unauthorized'), { statusCode: 401 });
  }
  return verify(authorization.slice(7));
}

export function requireScope(principal: Principal, scope: string): void {
  if (!principal.scopes.has(scope)) {
    throw Object.assign(new Error('forbidden'), { statusCode: 403 });
  }
}
