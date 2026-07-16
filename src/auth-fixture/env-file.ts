import { readFile } from 'node:fs/promises';

export function parseEnvironmentFile(contents: string): Record<string, string> {
  const environment: Record<string, string> = {};
  for (const [index, rawLine] of contents.split(/\r?\n/u).entries()) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const match = /^([A-Z][A-Z0-9_]*)=(.*)$/u.exec(line);
    if (!match) throw new Error(`invalid environment file line ${index + 1}`);
    const [, key, rawValue] = match;
    if (!key || rawValue === undefined) throw new Error(`invalid environment file line ${index + 1}`);
    let value = rawValue;
    if (rawValue.startsWith('"')) {
      try {
        const parsed: unknown = JSON.parse(rawValue);
        if (typeof parsed !== 'string') throw new Error('environment value must be a string');
        value = parsed;
      } catch {
        throw new Error(`invalid quoted environment value on line ${index + 1}`);
      }
    }
    environment[key] = value;
  }
  return environment;
}

export async function readEnvironmentFile(path: string): Promise<Record<string, string>> {
  return parseEnvironmentFile(await readFile(path, 'utf8'));
}
