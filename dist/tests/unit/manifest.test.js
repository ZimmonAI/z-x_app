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
    expect(fixtureAuth).toMatchObject({
        role: 'infrastructure',
        port: 3761,
        healthCheckUrl: 'http://127.0.0.1:3761/internal/health',
        localUrl: null,
        publicUrl: null,
        actionsEnabled: false,
        includeInGitSync: true,
    });
    expect(api).toMatchObject({
        role: 'main',
        dependsOn: ['z-x-fixture-auth'],
        port: 3762,
        healthCheckUrl: 'http://127.0.0.1:3762/internal/health',
        localUrl: 'http://100.106.76.100:3762',
        publicUrl: null,
        actionsEnabled: true,
        includeInGitSync: true,
    });
    expect(worker).toMatchObject({
        role: 'support',
        parentAppId: 'z-x-execution-runner-api',
        port: null,
        healthCheckUrl: null,
        localUrl: null,
        publicUrl: null,
        actionsEnabled: true,
        includeInGitSync: true,
    });
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