import { type FixtureAuthRuntimeConfig } from './config.js';
import { type FixtureAuthScope } from './constants.js';
export interface MintFixtureTokenOptions {
    config: FixtureAuthRuntimeConfig;
    ownerApp: string;
    scopes: string[];
    ttlSeconds?: number;
    now?: Date;
    jti?: string;
}
export interface MintedFixtureToken {
    token: string;
    expiresAt: string;
    scopes: FixtureAuthScope[];
}
export declare function mintFixtureToken(options: MintFixtureTokenOptions): Promise<MintedFixtureToken>;
interface MintCommandOptions {
    envFile: string;
    ownerApp: string;
    scopes: string[];
    outputFile: string;
    ttlSeconds?: number;
}
export declare function parseMintArguments(arguments_: string[]): MintCommandOptions;
export declare function runMintCommand(arguments_: string[]): Promise<void>;
export {};
