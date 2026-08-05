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
if (
  fixtureAuth.role !== 'infrastructure' ||
  fixtureAuth.port !== 3761 ||
  fixtureAuth.healthCheckUrl !== 'http://127.0.0.1:3761/internal/health' ||
  fixtureAuth.localUrl !== null ||
  fixtureAuth.publicUrl !== null ||
  fixtureAuth.actionsEnabled !== false ||
  fixtureAuth.includeInGitSync !== true
) {
  throw new Error('fixture auth runtime manifest invalid');
}
if (
  api.role !== 'main' ||
  JSON.stringify(api.dependsOn) !== JSON.stringify(['z-x-fixture-auth']) ||
  api.port !== 3762 ||
  api.healthCheckUrl !== 'http://127.0.0.1:3762/internal/health' ||
  api.localUrl !== 'http://100.106.76.100:3762' ||
  api.publicUrl !== null ||
  api.actionsEnabled !== true ||
  api.includeInGitSync !== true
) {
  throw new Error('API runtime manifest invalid');
}
if (
  worker.role !== 'support' ||
  worker.parentAppId !== 'z-x-execution-runner-api' ||
  worker.port !== null ||
  worker.healthCheckUrl !== null ||
  worker.localUrl !== null ||
  worker.publicUrl !== null ||
  worker.actionsEnabled !== true ||
  worker.includeInGitSync !== true
) {
  throw new Error('worker runtime manifest invalid');
}
