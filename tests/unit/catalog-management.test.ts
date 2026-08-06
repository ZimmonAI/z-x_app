import {
  CatalogImmutableError,
  CatalogManagementService,
  CatalogValidationError,
  type CatalogRepository,
} from '../../src/catalog/v1/management.js';
import type {
  BundleDefinition,
  BundleVersion,
  CatalogSnapshot,
  ManifestDefinition,
  ManifestVersion,
  RuntimePackage,
  ScriptDefinition,
  ScriptVersion,
} from '../../src/catalog/v1/types.js';
import { catalogFixture } from './catalog-fixture.js';

class MemoryCatalogRepository implements CatalogRepository {
  constructor(public readonly snapshot: CatalogSnapshot) {}

  async readSnapshot(): Promise<CatalogSnapshot> {
    return structuredClone(this.snapshot);
  }

  async readScriptVersion(id: string): Promise<ScriptVersion | null> {
    return structuredClone(this.snapshot.scriptVersions.find((script) => script.id === id) ?? null);
  }

  async readBundleVersion(id: string): Promise<BundleVersion | null> {
    return structuredClone(this.snapshot.bundleVersions.find((bundle) => bundle.id === id) ?? null);
  }

  async createManifestDefinition(definition: ManifestDefinition): Promise<void> {
    this.snapshot.manifestDefinitions.push(structuredClone(definition));
  }

  async createManifestVersion(version: ManifestVersion): Promise<void> {
    this.snapshot.manifestVersions.push(structuredClone(version));
  }

  async createScriptDefinition(definition: ScriptDefinition): Promise<void> {
    this.snapshot.scriptDefinitions.push(structuredClone(definition));
  }

  async createRuntimePackage(runtimePackage: RuntimePackage): Promise<void> {
    this.snapshot.runtimePackages.push(structuredClone(runtimePackage));
  }

  async createScriptVersion(version: ScriptVersion): Promise<void> {
    this.snapshot.scriptVersions.push(structuredClone(version));
  }

  async publishScriptVersion(id: string): Promise<void> {
    const script = this.snapshot.scriptVersions.find((candidate) => candidate.id === id);
    if (!script) {
      throw new Error('script version missing');
    }
    script.releaseStatus = 'published';
  }

  async createBundleDefinition(definition: BundleDefinition): Promise<void> {
    this.snapshot.bundleDefinitions.push(structuredClone(definition));
  }

  async createBundleVersion(version: BundleVersion): Promise<void> {
    if (this.snapshot.bundleVersions.some((bundle) => bundle.id === version.id)) {
      throw new Error('duplicate bundle version');
    }
    this.snapshot.bundleVersions.push(structuredClone(version));
  }

  async replaceDraftBundleVersion(version: BundleVersion): Promise<void> {
    const index = this.snapshot.bundleVersions.findIndex((bundle) => bundle.id === version.id);
    if (index < 0) {
      throw new Error('bundle version missing');
    }
    this.snapshot.bundleVersions[index] = structuredClone(version);
  }

  async publishBundleVersion(id: string): Promise<void> {
    const bundle = this.snapshot.bundleVersions.find((candidate) => candidate.id === id);
    if (!bundle) {
      throw new Error('bundle version missing');
    }
    bundle.releaseStatus = 'published';
  }
}

test('rejects fake executable runtime package truth', async () => {
  const { snapshot } = catalogFixture();
  const service = new CatalogManagementService(new MemoryCatalogRepository(snapshot));

  await expect(
    service.createRuntimePackage({
      id: 'fake-package',
      storageObjectRef: null,
      checksumSha256: null,
      entrypoint: null,
      executable: true,
      validationStatus: 'pending',
    }),
  ).rejects.toBeInstanceOf(CatalogValidationError);
});

test('publishes scripts and bundles only after package validation', async () => {
  const { snapshot } = catalogFixture();
  const repository = new MemoryCatalogRepository(snapshot);
  const service = new CatalogManagementService(repository);

  await expect(service.publishScriptVersion('script-submit-v1')).rejects.toBeInstanceOf(
    CatalogValidationError,
  );
  await expect(service.publishBundleVersion('bundle-v1')).rejects.toBeInstanceOf(
    CatalogValidationError,
  );

  for (const runtimePackage of repository.snapshot.runtimePackages) {
    runtimePackage.validationStatus = 'valid';
    runtimePackage.executable = true;
    runtimePackage.storageObjectRef = `zs://packages/${runtimePackage.id}`;
    runtimePackage.checksumSha256 = 'c'.repeat(64);
    runtimePackage.entrypoint = `${runtimePackage.id}.mjs`;
  }

  await service.publishScriptVersion('script-submit-v1');
  await service.publishScriptVersion('script-poll-v1');
  await service.publishBundleVersion('bundle-v1');

  expect(repository.snapshot.scriptVersions.every((script) => script.releaseStatus === 'published')).toBe(
    true,
  );
  expect(repository.snapshot.bundleVersions[0]?.releaseStatus).toBe('published');
  expect((await service.readCatalogSnapshot()).manifestVersions).toHaveLength(6);
});

test('published definitions cannot be edited and are cloned into new drafts', async () => {
  const { snapshot } = catalogFixture({
    bundleStatus: 'published',
    scriptStatus: 'published',
    packageValidationStatus: 'valid',
    packageExecutable: true,
  });
  const repository = new MemoryCatalogRepository(snapshot);
  const service = new CatalogManagementService(repository);
  const published = await service.readBundleVersion('bundle-v1');

  await expect(
    service.updateBundleDraft({ ...published, releaseStatus: 'draft' }),
  ).rejects.toBeInstanceOf(CatalogImmutableError);

  const draft = await service.clonePublishedBundleVersion('bundle-v1', {
    major: 1,
    minor: 1,
    patch: 0,
  });

  expect(draft.releaseStatus).toBe('draft');
  expect(draft.id).not.toBe(published.id);
  expect(draft.steps.map((step) => step.id)).not.toEqual(published.steps.map((step) => step.id));
  expect(draft.steps[1]?.inputBindings[0]?.source).toMatchObject({
    kind: 'step-output',
    sourceStepId: draft.steps[0]?.id,
  });
  expect(repository.snapshot.bundleVersions).toHaveLength(2);
});

test('repository duplicate rejection keeps bootstrap behavior explicit', async () => {
  const { snapshot, bundle } = catalogFixture();
  const service = new CatalogManagementService(new MemoryCatalogRepository(snapshot));

  await expect(service.createBundleVersion(bundle)).rejects.toThrow(/duplicate bundle version/);
});
