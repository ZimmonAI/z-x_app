import { z } from 'zod';
const bool=z.enum(['true','false']).transform(v=>v==='true');
const optionalUrl=z.string().url().optional();
const schema=z.object({
 ZX_NODE_ENV:z.enum(['development','test','production']).default('development'), ZX_DATABASE_URL:z.string().optional(),
 ZX_API_BIND_HOST:z.string().default('127.0.0.1'), ZX_API_PORT:z.coerce.number().int().min(1).max(65535).optional(),
 ZX_API_AUTH_ISSUER:z.string().optional(), ZX_API_AUTH_AUDIENCE:z.string().optional(), ZX_API_AUTH_JWKS_URL:optionalUrl,
 ZX_WORKER_ID:z.string().default('fixture-worker'), ZX_WORKER_CONCURRENCY:z.coerce.number().int().min(1).max(32).default(4),
 ZX_WORKER_LEASE_SECONDS:z.coerce.number().int().min(30).max(300).default(60), ZX_WORKER_HEARTBEAT_SECONDS:z.coerce.number().int().min(5).max(60).default(20),
 ZX_DEFAULT_TIMEOUT_SECONDS:z.coerce.number().int().min(30).max(3600).default(900), ZX_MAX_ATTEMPTS:z.coerce.number().int().min(1).max(5).default(3),
 ZX_Z_PROVIDER_BASE_URL:optionalUrl, ZX_Z_ACCOUNT_BASE_URL:optionalUrl, ZX_AUTO_HUB_BASE_URL:optionalUrl, ZX_Z_S_BASE_URL:optionalUrl, ZX_VIDEO_MAKER_CALLBACK_BASE_URL:optionalUrl,
 ZX_FEATURE_CALLBACKS_ENABLED:bool.default(false), ZX_FEATURE_REAL_DEPENDENCIES_ENABLED:bool.default(false),
 ZX_FEATURE_IMAGE_PROMPT_PREPARE_ENABLED:bool.default(true), ZX_FEATURE_IMAGE_GENERATE_ENABLED:bool.default(true), ZX_FEATURE_SCENE_VIDEO_PROMPT_PREPARE_ENABLED:bool.default(true), ZX_FEATURE_SCENE_VIDEO_GENERATE_ENABLED:bool.default(true),
 ZX_CANARY_PERCENT:z.coerce.number().min(0).max(100).default(0), ZX_LOG_LEVEL:z.enum(['fatal','error','warn','info','debug','trace','silent']).default('info')
}).strip();
export type Config=z.infer<typeof schema>;
export function loadConfig(env:NodeJS.ProcessEnv=process.env):Config { const c=schema.parse(env); if(c.ZX_FEATURE_REAL_DEPENDENCIES_ENABLED){const required=['ZX_Z_PROVIDER_BASE_URL','ZX_Z_ACCOUNT_BASE_URL','ZX_AUTO_HUB_BASE_URL','ZX_Z_S_BASE_URL'] as const; for(const k of required) if(!c[k]) throw new Error(`${k} required when real dependencies enabled`);} return c; }
