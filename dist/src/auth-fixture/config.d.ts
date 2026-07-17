import type { Config } from '../config.js';
import { FIXTURE_AUTH_ALGORITHM, FIXTURE_AUTH_AUDIENCE, FIXTURE_AUTH_DEFAULT_TOKEN_TTL_SECONDS, FIXTURE_AUTH_ISSUER, type FixturePrivateJwk, type FixturePublicJwks } from './constants.js';
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
export declare function loadFixtureAuthRuntimeConfig(config: Config): FixtureAuthRuntimeConfig;
