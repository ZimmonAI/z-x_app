import { type JWTPayload } from 'jose';
import type { FastifyRequest } from 'fastify';
import type { Config } from '../config.js';
export interface Principal {
    ownerApp: string;
    scopes: Set<string>;
    payload: JWTPayload;
}
export type AuthVerifier = (token: string) => Promise<Principal>;
export declare function createAuthVerifier(config: Config): AuthVerifier;
export declare function authenticate(request: FastifyRequest, verify: AuthVerifier): Promise<Principal>;
export declare function requireScope(principal: Principal, scope: string): void;
