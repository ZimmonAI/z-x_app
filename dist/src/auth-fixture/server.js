import Fastify from 'fastify';
import { FIXTURE_AUTH_HEALTH_PATH, FIXTURE_AUTH_JWKS_PATH } from './constants.js';
export function buildFixtureAuthServer(config) {
    const app = Fastify({
        logger: false,
        bodyLimit: 1_024,
        exposeHeadRoutes: false,
    });
    app.get(FIXTURE_AUTH_HEALTH_PATH, async (_request, reply) => {
        void reply.header('cache-control', 'no-store');
        return { status: 'alive' };
    });
    app.get(FIXTURE_AUTH_JWKS_PATH, async (_request, reply) => {
        void reply.header('cache-control', 'public, max-age=60');
        return config.publicJwks;
    });
    app.setNotFoundHandler((_request, reply) => {
        void reply.code(404).send({ error: 'not found' });
    });
    app.setErrorHandler((_error, _request, reply) => {
        void reply.code(500).send({ error: 'internal safe failure' });
    });
    return app;
}
//# sourceMappingURL=server.js.map