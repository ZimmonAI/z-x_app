import { readFile } from 'node:fs/promises';

const manifest = JSON.parse(await readFile(new URL('../zimspace.app.json', import.meta.url), 'utf8'));
const expectedIds = [
  'z-x-fixture-auth',
  'z-x-execution-runner-api',
  'z-x-execution-runner-worker',
];

if (
  manifest.schemaVersion !== 1 ||
  manifest.project?.id !== 'z-x' ||
  !Array.isArray(manifest.apps) ||
  manifest.apps.length !== expectedIds.length
) {
  throw new Error('manifest root shape invalid');
}

const apps = new Map(manifest.apps.map((app) => [app.id, app]));
if (expectedIds.some((id) => !apps.has(id)) || apps.size !== expectedIds.length) {
  throw new Error('manifest runtime IDs invalid');
}

const fixtureAuth = apps.get('z-x-fixture-auth');
const api = apps.get('z-x-execution-runner-api');
const worker = apps.get('z-x-execution-runner-worker');
if (fixtureAuth.role !== 'infrastructure') throw new Error('fixture auth role invalid');
if (api.role !== 'main' || JSON.stringify(api.dependsOn) !== JSON.stringify(['z-x-fixture-auth'])) {
  throw new Error('API dependency invalid');
}
if (worker.role !== 'support' || worker.parentAppId !== 'z-x-execution-runner-api') {
  throw new Error('worker parent invalid');
}
for (const app of manifest.apps) {
  if (
    app.port !== null ||
    app.healthCheckUrl !== null ||
    app.localUrl !== null ||
    app.publicUrl !== null ||
    app.actionsEnabled !== false ||
    app.includeInGitSync !== true
  ) {
    throw new Error(`runtime remains unresolved or disabled: ${app.id}`);
  }
}
