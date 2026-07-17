import { z } from 'zod';
const booleanFromEnvironment = z
    .enum(['true', 'false'])
    .transform((value) => value === 'true');
const optionalUrl = z.string().url().optional();
const configSchema = z
    .object({
    ZX_NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    ZX_DATABASE_URL: z.string().min(1).optional(),
    ZX_API_BIND_HOST: z.string().min(1).default('127.0.0.1'),
    ZX_API_PORT: z.coerce.number().int().min(1).max(65_535).optional(),
    ZX_API_AUTH_ISSUER: z.string().min(1).optional(),
    ZX_API_AUTH_AUDIENCE: z.string().min(1).optional(),
    ZX_API_AUTH_JWKS_URL: optionalUrl,
    ZX_FIXTURE_AUTH_BIND_HOST: z.string().min(1).optional(),
    ZX_FIXTURE_AUTH_PORT: z.coerce.number().int().min(1).max(65_535).optional(),
    ZX_FIXTURE_AUTH_ISSUER: z.string().min(1).optional(),
    ZX_FIXTURE_AUTH_AUDIENCE: z.string().min(1).optional(),
    ZX_FIXTURE_AUTH_ALGORITHM: z.enum(['ES256']).optional(),
    ZX_FIXTURE_AUTH_KEY_ID: z.string().min(1).optional(),
    ZX_FIXTURE_AUTH_PRIVATE_JWK_JSON: z.string().min(1).optional(),
    ZX_FIXTURE_AUTH_PUBLIC_JWKS_JSON: z.string().min(1).optional(),
    ZX_FIXTURE_AUTH_TOKEN_TTL_SECONDS: z.coerce.number().int().min(1).max(300).optional(),
    ZX_WORKER_ID: z.string().min(1).default('fixture-worker'),
    ZX_WORKER_CONCURRENCY: z.coerce.number().int().min(1).max(32).default(4),
    ZX_WORKER_LEASE_SECONDS: z.coerce.number().int().min(30).max(300).default(60),
    ZX_WORKER_HEARTBEAT_SECONDS: z.coerce.number().int().min(5).max(60).default(20),
    ZX_WORKER_CONTROL_DIR: z.string().min(1).optional(),
    ZX_DEFAULT_TIMEOUT_SECONDS: z.coerce.number().int().min(30).max(3600).default(900),
    ZX_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(5).default(3),
    ZX_Z_PROVIDER_BASE_URL: optionalUrl,
    ZX_Z_ACCOUNT_BASE_URL: optionalUrl,
    ZX_AUTO_HUB_BASE_URL: optionalUrl,
    ZX_Z_S_BASE_URL: optionalUrl,
    ZX_VIDEO_MAKER_CALLBACK_BASE_URL: optionalUrl,
    ZX_FEATURE_CALLBACKS_ENABLED: booleanFromEnvironment.default(false),
    ZX_FEATURE_REAL_DEPENDENCIES_ENABLED: booleanFromEnvironment.default(false),
    ZX_FEATURE_IMAGE_PROMPT_PREPARE_ENABLED: booleanFromEnvironment.default(false),
    ZX_FEATURE_IMAGE_GENERATE_ENABLED: booleanFromEnvironment.default(false),
    ZX_FEATURE_SCENE_VIDEO_PROMPT_PREPARE_ENABLED: booleanFromEnvironment.default(false),
    ZX_FEATURE_SCENE_VIDEO_GENERATE_ENABLED: booleanFromEnvironment.default(false),
    ZX_CANARY_PERCENT: z.coerce.number().min(0).max(100).default(0),
    ZX_LOG_LEVEL: z
        .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
        .default('info'),
})
    .strip()
    .superRefine((config, context) => {
    if (config.ZX_WORKER_HEARTBEAT_SECONDS >= config.ZX_WORKER_LEASE_SECONDS) {
        context.addIssue({
            code: 'custom',
            path: ['ZX_WORKER_HEARTBEAT_SECONDS'],
            message: 'heartbeat interval must be shorter than the lease duration',
        });
    }
    if (config.ZX_FEATURE_CALLBACKS_ENABLED && !config.ZX_VIDEO_MAKER_CALLBACK_BASE_URL) {
        context.addIssue({
            code: 'custom',
            path: ['ZX_VIDEO_MAKER_CALLBACK_BASE_URL'],
            message: 'callback base URL is required when callbacks are enabled',
        });
    }
    if (config.ZX_FEATURE_REAL_DEPENDENCIES_ENABLED) {
        const required = [
            'ZX_Z_PROVIDER_BASE_URL',
            'ZX_Z_ACCOUNT_BASE_URL',
            'ZX_AUTO_HUB_BASE_URL',
            'ZX_Z_S_BASE_URL',
        ];
        for (const key of required) {
            if (!config[key]) {
                context.addIssue({
                    code: 'custom',
                    path: [key],
                    message: `${key} is required when real dependencies are enabled`,
                });
            }
        }
    }
});
export function loadConfig(environment = process.env) {
    return configSchema.parse(environment);
}
//# sourceMappingURL=config.js.map