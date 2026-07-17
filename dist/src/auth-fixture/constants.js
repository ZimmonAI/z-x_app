import { createHash } from 'node:crypto';
export const FIXTURE_AUTH_RUNTIME_ID = 'z-x-fixture-auth';
export const FIXTURE_AUTH_ISSUER = 'urn:zimspace:z-x:fixture-auth';
export const FIXTURE_AUTH_AUDIENCE = 'z-x-execution-runner';
export const FIXTURE_AUTH_ALGORITHM = 'ES256';
export const FIXTURE_AUTH_JWKS_PATH = '/.well-known/jwks.json';
export const FIXTURE_AUTH_HEALTH_PATH = '/internal/health';
export const FIXTURE_AUTH_DEFAULT_TOKEN_TTL_SECONDS = 300;
export const FIXTURE_AUTH_MAX_TOKEN_TTL_SECONDS = 300;
export const FIXTURE_AUTH_ALLOWED_OWNER_APP = 'z-x-deployment-canary';
export const FIXTURE_AUTH_ALLOWED_SCOPES = [
    'zx.executions.submit',
    'zx.executions.read',
    'zx.executions.cancel',
    'zx.executions.retry',
    'zx.executions.reconcile',
];
export function calculateFixtureKeyId(publicJwk) {
    const canonical = JSON.stringify({
        crv: publicJwk.crv,
        kty: publicJwk.kty,
        x: publicJwk.x,
        y: publicJwk.y,
    });
    return createHash('sha256').update(canonical).digest('base64url');
}
//# sourceMappingURL=constants.js.map