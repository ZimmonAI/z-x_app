import { readFile } from 'node:fs/promises';
test('manifest uses root apps with exact auth, API, and worker relationships', async () => {
    const manifest = JSON.parse(await readFile('zimspace.app.json', 'utf8'));
    expect(manifest.schemaVersion).toBe(1);
    expect(manifest.project.id).toBe('z-x');
    expect(manifest.apps.map((app) => app.id)).toEqual([
        'z-x-fixture-auth',
        'z-x-execution-runner-api',
        'z-x-execution-runner-worker',
    ]);
    const fixtureAuth = manifest.apps[0];
    const api = manifest.apps[1];
    const worker = manifest.apps[2];
    expect(fixtureAuth?.role).toBe('infrastructure');
    expect(api?.dependsOn).toEqual(['z-x-fixture-auth']);
    expect(worker).toMatchObject({
        role: 'support',
        parentAppId: 'z-x-execution-runner-api',
    });
    for (const app of manifest.apps) {
        expect(app.port).toBeNull();
        expect(app.healthCheckUrl).toBeNull();
        expect(app.localUrl).toBeNull();
        expect(app.publicUrl).toBeNull();
        expect(app.actionsEnabled).toBe(false);
        expect(app.includeInGitSync).toBe(true);
    }
});
test('runtime control artifacts are ignored and excluded from package output', async () => {
    const gitignore = await readFile('.gitignore', 'utf8');
    const eslintConfig = await readFile('eslint.config.js', 'utf8');
    const tsconfig = JSON.parse(await readFile('tsconfig.json', 'utf8'));
    const packageJson = JSON.parse(await readFile('package.json', 'utf8'));
    expect(gitignore.split(/\r?\n/u)).toContain('.runtime/');
    expect(eslintConfig).toContain("'.runtime/**'");
    expect(tsconfig.include.some((entry) => entry.includes('.runtime'))).toBe(false);
    expect(packageJson.files).not.toContain('.runtime');
    expect(packageJson.files).not.toContain('.runtime/');
    expect(packageJson.scripts).toMatchObject({
        'start:auth-fixture': 'node --enable-source-maps dist/src/auth-fixture/main.js',
        'fixture-auth:mint': 'node --enable-source-maps dist/src/auth-fixture/mint.js',
        'worker:request-stop': 'node --enable-source-maps dist/src/worker/request-stop.js',
        'manifest:validate': 'node scripts/validate-manifest.mjs',
    });
});
//# sourceMappingURL=manifest.test.js.map