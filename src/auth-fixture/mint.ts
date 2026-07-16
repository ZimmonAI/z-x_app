import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { importJWK, SignJWT } from 'jose';
import { loadConfig } from '../config.js';
import { loadFixtureAuthRuntimeConfig, type FixtureAuthRuntimeConfig } from './config.js';
import {
  FIXTURE_AUTH_ALLOWED_OWNER_APP,
  FIXTURE_AUTH_ALLOWED_SCOPES,
  FIXTURE_AUTH_MAX_TOKEN_TTL_SECONDS,
  type FixtureAuthScope,
} from './constants.js';
import { readEnvironmentFile } from './env-file.js';

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

function validateScopes(scopes: string[]): FixtureAuthScope[] {
  if (scopes.length === 0) throw new Error('at least one --scope required');
  const allowed = new Set<string>(FIXTURE_AUTH_ALLOWED_SCOPES);
  const unique = new Set<string>();
  for (const scope of scopes) {
    if (!allowed.has(scope)) throw new Error(`scope not allowed: ${scope}`);
    if (unique.has(scope)) throw new Error(`duplicate scope: ${scope}`);
    unique.add(scope);
  }
  return scopes as FixtureAuthScope[];
}

export async function mintFixtureToken(options: MintFixtureTokenOptions): Promise<MintedFixtureToken> {
  if (options.ownerApp !== FIXTURE_AUTH_ALLOWED_OWNER_APP) {
    throw new Error(`owner app must be ${FIXTURE_AUTH_ALLOWED_OWNER_APP}`);
  }
  const scopes = validateScopes(options.scopes);
  const ttlSeconds = options.ttlSeconds ?? options.config.tokenTtlSeconds;
  if (
    !Number.isInteger(ttlSeconds) ||
    ttlSeconds < 1 ||
    ttlSeconds > FIXTURE_AUTH_MAX_TOKEN_TTL_SECONDS ||
    ttlSeconds > options.config.tokenTtlSeconds
  ) {
    throw new Error('token TTL must be between 1 and 300 seconds');
  }
  const nowSeconds = Math.floor((options.now ?? new Date()).getTime() / 1_000);
  const expiresAtSeconds = nowSeconds + ttlSeconds;
  const signingKey = await importJWK(options.config.privateJwk, options.config.algorithm);
  const token = await new SignJWT({
    owner_app: options.ownerApp,
    scope: scopes.join(' '),
    kid: options.config.keyId,
  })
    .setProtectedHeader({ alg: options.config.algorithm, kid: options.config.keyId, typ: 'JWT' })
    .setIssuer(options.config.issuer)
    .setAudience(options.config.audience)
    .setSubject(options.ownerApp)
    .setIssuedAt(nowSeconds)
    .setExpirationTime(expiresAtSeconds)
    .setJti(options.jti ?? randomUUID())
    .sign(signingKey);
  return {
    token,
    scopes,
    expiresAt: new Date(expiresAtSeconds * 1_000).toISOString(),
  };
}

interface MintCommandOptions {
  envFile: string;
  ownerApp: string;
  scopes: string[];
  outputFile: string;
  ttlSeconds?: number;
}

export function parseMintArguments(arguments_: string[]): MintCommandOptions {
  const options: Partial<MintCommandOptions> & { scopes: string[] } = { scopes: [] };
  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index];
    const next = arguments_[index + 1];
    if (!next || next.startsWith('--')) throw new Error(`${argument} requires a value`);
    if (argument === '--env-file') options.envFile = next;
    else if (argument === '--owner-app') options.ownerApp = next;
    else if (argument === '--scope') options.scopes.push(next);
    else if (argument === '--output-file') options.outputFile = next;
    else if (argument === '--ttl-seconds') options.ttlSeconds = Number(next);
    else throw new Error(`unknown argument: ${argument}`);
    index += 1;
  }
  if (!options.envFile) throw new Error('--env-file required');
  if (!options.ownerApp) throw new Error('--owner-app required');
  if (!options.outputFile) throw new Error('--output-file required');
  if (options.scopes.length === 0) throw new Error('at least one --scope required');
  return options as MintCommandOptions;
}

export async function runMintCommand(arguments_: string[]): Promise<void> {
  const options = parseMintArguments(arguments_);
  const environment = await readEnvironmentFile(options.envFile);
  const config = loadFixtureAuthRuntimeConfig(loadConfig(environment));
  const minted = await mintFixtureToken({
    config,
    ownerApp: options.ownerApp,
    scopes: options.scopes,
    ttlSeconds: options.ttlSeconds,
  });
  const outputPath = resolve(options.outputFile);
  await mkdir(dirname(outputPath), { recursive: true, mode: 0o700 });
  await writeFile(outputPath, `${minted.token}\n`, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
  process.stdout.write(`fixture token written: ${outputPath}\n`);
  process.stdout.write(`owner app: ${options.ownerApp}\n`);
  process.stdout.write(`scopes: ${minted.scopes.join(' ')}\n`);
  process.stdout.write(`expires at: ${minted.expiresAt}\n`);
}

const entrypoint = process.argv[1];
if (entrypoint && import.meta.url === pathToFileURL(entrypoint).href) {
  runMintCommand(process.argv.slice(2)).catch(() => {
    process.stderr.write('fixture token mint failed safely\n');
    process.exitCode = 1;
  });
}
