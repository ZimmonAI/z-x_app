import { createRemoteJWKSet, jwtVerify } from 'jose';
export function createAuthVerifier(config) {
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
        if (!ownerApp)
            throw new Error('owner_app missing');
        return { ownerApp, scopes: new Set(scope.filter(Boolean)), payload };
    };
}
export async function authenticate(request, verify) {
    const authorization = request.headers.authorization;
    if (!authorization?.startsWith('Bearer ') || authorization.length <= 7) {
        throw Object.assign(new Error('unauthorized'), { statusCode: 401 });
    }
    try {
        return await verify(authorization.slice(7));
    }
    catch {
        throw Object.assign(new Error('unauthorized'), { statusCode: 401 });
    }
}
export function requireScope(principal, scope) {
    if (!principal.scopes.has(scope)) {
        throw Object.assign(new Error('forbidden'), { statusCode: 403 });
    }
}
//# sourceMappingURL=auth.js.map