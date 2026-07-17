import { z } from 'zod';
declare const configSchema: z.ZodObject<{
    ZX_NODE_ENV: z.ZodDefault<z.ZodEnum<{
        development: "development";
        test: "test";
        production: "production";
    }>>;
    ZX_DATABASE_URL: z.ZodOptional<z.ZodString>;
    ZX_API_BIND_HOST: z.ZodDefault<z.ZodString>;
    ZX_API_PORT: z.ZodOptional<z.ZodCoercedNumber<unknown>>;
    ZX_API_AUTH_ISSUER: z.ZodOptional<z.ZodString>;
    ZX_API_AUTH_AUDIENCE: z.ZodOptional<z.ZodString>;
    ZX_API_AUTH_JWKS_URL: z.ZodOptional<z.ZodString>;
    ZX_FIXTURE_AUTH_BIND_HOST: z.ZodOptional<z.ZodString>;
    ZX_FIXTURE_AUTH_PORT: z.ZodOptional<z.ZodCoercedNumber<unknown>>;
    ZX_FIXTURE_AUTH_ISSUER: z.ZodOptional<z.ZodString>;
    ZX_FIXTURE_AUTH_AUDIENCE: z.ZodOptional<z.ZodString>;
    ZX_FIXTURE_AUTH_ALGORITHM: z.ZodOptional<z.ZodEnum<{
        ES256: "ES256";
    }>>;
    ZX_FIXTURE_AUTH_KEY_ID: z.ZodOptional<z.ZodString>;
    ZX_FIXTURE_AUTH_PRIVATE_JWK_JSON: z.ZodOptional<z.ZodString>;
    ZX_FIXTURE_AUTH_PUBLIC_JWKS_JSON: z.ZodOptional<z.ZodString>;
    ZX_FIXTURE_AUTH_TOKEN_TTL_SECONDS: z.ZodOptional<z.ZodCoercedNumber<unknown>>;
    ZX_WORKER_ID: z.ZodDefault<z.ZodString>;
    ZX_WORKER_CONCURRENCY: z.ZodDefault<z.ZodCoercedNumber<unknown>>;
    ZX_WORKER_LEASE_SECONDS: z.ZodDefault<z.ZodCoercedNumber<unknown>>;
    ZX_WORKER_HEARTBEAT_SECONDS: z.ZodDefault<z.ZodCoercedNumber<unknown>>;
    ZX_WORKER_CONTROL_DIR: z.ZodOptional<z.ZodString>;
    ZX_DEFAULT_TIMEOUT_SECONDS: z.ZodDefault<z.ZodCoercedNumber<unknown>>;
    ZX_MAX_ATTEMPTS: z.ZodDefault<z.ZodCoercedNumber<unknown>>;
    ZX_Z_PROVIDER_BASE_URL: z.ZodOptional<z.ZodString>;
    ZX_Z_ACCOUNT_BASE_URL: z.ZodOptional<z.ZodString>;
    ZX_AUTO_HUB_BASE_URL: z.ZodOptional<z.ZodString>;
    ZX_Z_S_BASE_URL: z.ZodOptional<z.ZodString>;
    ZX_VIDEO_MAKER_CALLBACK_BASE_URL: z.ZodOptional<z.ZodString>;
    ZX_FEATURE_CALLBACKS_ENABLED: z.ZodDefault<z.ZodPipe<z.ZodEnum<{
        true: "true";
        false: "false";
    }>, z.ZodTransform<boolean, "true" | "false">>>;
    ZX_FEATURE_REAL_DEPENDENCIES_ENABLED: z.ZodDefault<z.ZodPipe<z.ZodEnum<{
        true: "true";
        false: "false";
    }>, z.ZodTransform<boolean, "true" | "false">>>;
    ZX_FEATURE_IMAGE_PROMPT_PREPARE_ENABLED: z.ZodDefault<z.ZodPipe<z.ZodEnum<{
        true: "true";
        false: "false";
    }>, z.ZodTransform<boolean, "true" | "false">>>;
    ZX_FEATURE_IMAGE_GENERATE_ENABLED: z.ZodDefault<z.ZodPipe<z.ZodEnum<{
        true: "true";
        false: "false";
    }>, z.ZodTransform<boolean, "true" | "false">>>;
    ZX_FEATURE_SCENE_VIDEO_PROMPT_PREPARE_ENABLED: z.ZodDefault<z.ZodPipe<z.ZodEnum<{
        true: "true";
        false: "false";
    }>, z.ZodTransform<boolean, "true" | "false">>>;
    ZX_FEATURE_SCENE_VIDEO_GENERATE_ENABLED: z.ZodDefault<z.ZodPipe<z.ZodEnum<{
        true: "true";
        false: "false";
    }>, z.ZodTransform<boolean, "true" | "false">>>;
    ZX_CANARY_PERCENT: z.ZodDefault<z.ZodCoercedNumber<unknown>>;
    ZX_LOG_LEVEL: z.ZodDefault<z.ZodEnum<{
        error: "error";
        fatal: "fatal";
        warn: "warn";
        info: "info";
        debug: "debug";
        trace: "trace";
        silent: "silent";
    }>>;
}, z.core.$strip>;
export type Config = z.infer<typeof configSchema>;
export declare function loadConfig(environment?: NodeJS.ProcessEnv): Config;
export {};
