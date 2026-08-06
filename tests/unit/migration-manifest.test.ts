import fs from 'node:fs/promises';

test('reserves normalized migration without applying missing SQL', async () => {
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
  ]);
  expect(manifest.migrations.at(-1)).toMatchObject({
    id: '0003-normalized-script-bundle-foundation',
    enabled: false,
    revisionKey: 'normalized-script-bundle-foundation-v1',
    expectedTableCountAfterUp: 56,
    up: 'migrations/0003_normalized_script_bundle_foundation_up.sql',
    down: 'migrations/0003_normalized_script_bundle_foundation_down.sql',
  });
});
