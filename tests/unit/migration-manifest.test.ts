import fs from 'node:fs/promises';

test('reserves normalized/runtime-affinity migrations and enables reviewed generic transport SQL', async () => {
  const manifest = JSON.parse(await fs.readFile('migrations/manifest.json', 'utf8')) as {
    migrations: Array<{
      id: string;
      up: string;
      down: string;
      enabled: boolean;
      revisionKey?: string;
      expectedTableCountAfterUp: number;
    }>;
  };

  expect(manifest.migrations.filter((migration) => migration.enabled).map((migration) => migration.id)).toEqual([
    '0001-execution-foundation',
    '0002-video-maker-phase-engine',
    '0005-generic-execution-authority-transport',
  ]);
  expect(manifest.migrations[2]).toMatchObject({
    id: '0003-normalized-script-bundle-foundation',
    enabled: false,
    revisionKey: 'normalized-script-bundle-foundation-v1',
    expectedTableCountAfterUp: 56,
    up: 'migrations/0003_normalized_script_bundle_foundation_up.sql',
    down: 'migrations/0003_normalized_script_bundle_foundation_down.sql',
  });
  expect(manifest.migrations[3]).toMatchObject({
    id: '0004-step-runtime-affinity',
    enabled: false,
    revisionKey: 'step-runtime-affinity-v1',
    expectedTableCountAfterUp: 58,
    up: 'migrations/0004_step_runtime_affinity_up.sql',
    down: 'migrations/0004_step_runtime_affinity_down.sql',
  });
  expect(manifest.migrations[4]).toMatchObject({
    id: '0005-generic-execution-authority-transport',
    enabled: true,
    revisionKey: 'generic-execution-authority-transport-v1',
    expectedTableCountAfterUp: 8,
    up: 'migrations/0005_generic_execution_authority_transport_up.sql',
    down: 'migrations/0005_generic_execution_authority_transport_down.sql',
  });
});
