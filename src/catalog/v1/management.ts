import { randomUUID } from 'node:crypto';
import type {
  BundleDefinition,
  BundleVersion,
  CatalogSnapshot,
  ManifestDefinition,
  ManifestVersion,
  RuntimePackage,
  ScriptDefinition,
  ScriptVersion,
  SemanticVersion,
  StepInputBindingSource,
} from './types.js';
import {
  validateBundleVersion,
  type CatalogValidationResult,
} from './validation.js';

export interface CatalogRepository {
  readSnapshot(): Promise<CatalogSnapshot>;
  readScriptVersion(id: string): Promise<ScriptVersion | null>;
  readBundleVersion(id: string): Promise<BundleVersion | null>;
  createManifestDefinition(definition: ManifestDefinition): Promise<void>;
  createManifestVersion(version: ManifestVersion): Promise<void>;
  createScriptDefinition(definition: ScriptDefinition): Promise<void>;
  createRuntimePackage(runtimePackage: RuntimePackage): Promise<void>;
  createScriptVersion(version: ScriptVersion): Promise<void>;
  publishScriptVersion(id: string): Promise<void>;
  createBundleDefinition(definition: BundleDefinition): Promise<void>;
  createBundleVersion(version: BundleVersion): Promise<void>;
  replaceDraftBundleVersion(version: BundleVersion): Promise<void>;
  publishBundleVersion(id: string): Promise<void>;
}

export class CatalogNotFoundError extends Error {
  constructor(entity: string, id: string) {
    super(`${entity} ${id} was not found`);
    this.name = 'CatalogNotFoundError';
  }
}

export class CatalogImmutableError extends Error {
  constructor(message = 'published catalog versions are immutable') {
    super(message);
    this.name = 'CatalogImmutableError';
  }
}

export class CatalogValidationError extends Error {
  constructor(public readonly result: CatalogValidationResult) {
    super('catalog validation failed');
    this.name = 'CatalogValidationError';
  }
}

function cloneBindingSource(
  source: StepInputBindingSource,
  inputIds: Map<string, string>,
  stepIds: Map<string, string>,
): StepInputBindingSource {
  if (source.kind === 'bundle-input') {
    const bundleInputUsageId = inputIds.get(source.bundleInputUsageId);
    if (!bundleInputUsageId) {
      throw new Error(`cannot clone missing bundle input ${source.bundleInputUsageId}`);
    }
    return { kind: 'bundle-input', bundleInputUsageId };
  }
  if (source.kind === 'step-output') {
    const sourceStepId = stepIds.get(source.sourceStepId);
    if (!sourceStepId) {
      throw new Error(`cannot clone missing source step ${source.sourceStepId}`);
    }
    return {
      kind: 'step-output',
      sourceStepId,
      sourceScriptOutputUsageId: source.sourceScriptOutputUsageId,
    };
  }
  return { ...source };
}

function validateScriptPublication(
  snapshot: CatalogSnapshot,
  script: ScriptVersion,
): CatalogValidationResult {
  const issues: CatalogValidationResult['issues'] = [];
  if (!snapshot.scriptDefinitions.some((definition) => definition.id === script.scriptDefinitionId)) {
    issues.push({
      code: 'missing-reference',
      path: `scriptVersions.${script.id}.scriptDefinitionId`,
      message: `script definition ${script.scriptDefinitionId} does not exist`,
    });
  }
  const runtimePackage = snapshot.runtimePackages.find(
    (candidate) => candidate.id === script.runtimePackageId,
  );
  if (!runtimePackage) {
    issues.push({
      code: 'missing-reference',
      path: `scriptVersions.${script.id}.runtimePackageId`,
      message: `runtime package ${script.runtimePackageId} does not exist`,
    });
  } else if (
    runtimePackage.validationStatus !== 'valid' ||
    !runtimePackage.executable ||
    !runtimePackage.storageObjectRef ||
    !runtimePackage.checksumSha256 ||
    !runtimePackage.entrypoint
  ) {
    issues.push({
      code: 'publication-gate',
      path: `scriptVersions.${script.id}.runtimePackageId`,
      message: 'published script versions require a validated executable package',
    });
  }
  const manifestVersionIds = new Set(snapshot.manifestVersions.map((version) => version.id));
  for (const usage of [...script.inputUsages, ...script.outputUsages]) {
    if (!manifestVersionIds.has(usage.manifestVersionId)) {
      issues.push({
        code: 'missing-reference',
        path: `scriptVersions.${script.id}.manifestUsages.${usage.id}`,
        message: `manifest version ${usage.manifestVersionId} does not exist`,
      });
    }
  }
  return { valid: issues.length === 0, issues };
}

export class CatalogManagementService {
  constructor(private readonly repository: CatalogRepository) {}

  async readCatalogSnapshot(): Promise<CatalogSnapshot> {
    return structuredClone(await this.repository.readSnapshot());
  }

  async createManifestDefinition(definition: ManifestDefinition): Promise<void> {
    await this.repository.createManifestDefinition(structuredClone(definition));
  }

  async createManifestVersion(version: ManifestVersion): Promise<void> {
    await this.repository.createManifestVersion(structuredClone(version));
  }

  async createScriptDefinition(definition: ScriptDefinition): Promise<void> {
    await this.repository.createScriptDefinition(structuredClone(definition));
  }

  async createRuntimePackage(runtimePackage: RuntimePackage): Promise<void> {
    if (runtimePackage.validationStatus !== 'valid' && runtimePackage.executable) {
      throw new CatalogValidationError({
        valid: false,
        issues: [
          {
            code: 'publication-gate',
            path: `runtimePackages.${runtimePackage.id}`,
            message: 'unvalidated runtime packages cannot claim executable truth',
          },
        ],
      });
    }
    await this.repository.createRuntimePackage(structuredClone(runtimePackage));
  }

  async createScriptVersion(version: ScriptVersion): Promise<void> {
    if (version.releaseStatus === 'published') {
      const result = validateScriptPublication(await this.repository.readSnapshot(), version);
      if (!result.valid) {
        throw new CatalogValidationError(result);
      }
    }
    await this.repository.createScriptVersion(structuredClone(version));
  }

  async readScriptVersion(id: string): Promise<ScriptVersion> {
    const script = await this.repository.readScriptVersion(id);
    if (!script) {
      throw new CatalogNotFoundError('script version', id);
    }
    return structuredClone(script);
  }

  async publishScriptVersion(id: string): Promise<void> {
    const [snapshot, script] = await Promise.all([
      this.repository.readSnapshot(),
      this.readScriptVersion(id),
    ]);
    if (script.releaseStatus === 'published') {
      throw new CatalogImmutableError('script version is already published');
    }
    const result = validateScriptPublication(snapshot, script);
    if (!result.valid) {
      throw new CatalogValidationError(result);
    }
    await this.repository.publishScriptVersion(id);
  }

  async createBundleDefinition(definition: BundleDefinition): Promise<void> {
    await this.repository.createBundleDefinition(structuredClone(definition));
  }

  async createBundleVersion(version: BundleVersion): Promise<void> {
    if (version.releaseStatus !== 'draft') {
      throw new CatalogImmutableError('new bundle versions must begin as drafts');
    }
    await this.repository.createBundleVersion(structuredClone(version));
  }

  async readBundleVersion(id: string): Promise<BundleVersion> {
    const bundle = await this.repository.readBundleVersion(id);
    if (!bundle) {
      throw new CatalogNotFoundError('bundle version', id);
    }
    return structuredClone(bundle);
  }

  async updateBundleDraft(version: BundleVersion): Promise<void> {
    const current = await this.readBundleVersion(version.id);
    if (current.releaseStatus === 'published') {
      throw new CatalogImmutableError();
    }
    if (version.releaseStatus !== 'draft') {
      throw new CatalogImmutableError('draft updates cannot publish by replacement');
    }
    await this.repository.replaceDraftBundleVersion(structuredClone(version));
  }

  async validateBundleVersion(id: string): Promise<CatalogValidationResult> {
    const [snapshot, bundle] = await Promise.all([
      this.repository.readSnapshot(),
      this.readBundleVersion(id),
    ]);
    return validateBundleVersion(snapshot, bundle);
  }

  async publishBundleVersion(id: string): Promise<void> {
    const [snapshot, current] = await Promise.all([
      this.repository.readSnapshot(),
      this.readBundleVersion(id),
    ]);
    if (current.releaseStatus === 'published') {
      throw new CatalogImmutableError('bundle version is already published');
    }
    const candidate: BundleVersion = { ...current, releaseStatus: 'published' };
    const result = validateBundleVersion(snapshot, candidate);
    if (!result.valid) {
      throw new CatalogValidationError(result);
    }
    await this.repository.publishBundleVersion(id);
  }

  async clonePublishedBundleVersion(
    sourceId: string,
    version: SemanticVersion,
  ): Promise<BundleVersion> {
    const source = await this.readBundleVersion(sourceId);
    if (source.releaseStatus !== 'published') {
      throw new CatalogImmutableError('only published versions may be cloned into a new draft');
    }

    const bundleInputIds = new Map(source.inputUsages.map((usage) => [usage.id, randomUUID()]));
    const bundleOutputIds = new Map(source.outputUsages.map((usage) => [usage.id, randomUUID()]));
    const stepIds = new Map(source.steps.map((step) => [step.id, randomUUID()]));

    const draft: BundleVersion = {
      id: randomUUID(),
      bundleDefinitionId: source.bundleDefinitionId,
      version,
      releaseStatus: 'draft',
      inputUsages: source.inputUsages.map((usage) => ({
        ...usage,
        id: bundleInputIds.get(usage.id) ?? randomUUID(),
      })),
      outputUsages: source.outputUsages.map((usage) => ({
        ...usage,
        id: bundleOutputIds.get(usage.id) ?? randomUUID(),
      })),
      steps: source.steps.map((step) => ({
        ...step,
        id: stepIds.get(step.id) ?? randomUUID(),
        tags: [...step.tags],
        policy: { ...step.policy },
        inputBindings: step.inputBindings.map((binding) => ({
          ...binding,
          id: randomUUID(),
          source: cloneBindingSource(binding.source, bundleInputIds, stepIds),
        })),
        runtimeAffinityBindings: step.runtimeAffinityBindings.map((binding) => {
          const sourceStepId = stepIds.get(binding.sourceStepId);
          if (!sourceStepId) {
            throw new Error(`cannot clone missing affinity source step ${binding.sourceStepId}`);
          }
          return {
            ...binding,
            id: randomUUID(),
            sourceStepId,
          };
        }),
      })),
      finalOutputBindings: source.finalOutputBindings.map((binding) => {
        const bundleOutputUsageId = bundleOutputIds.get(binding.bundleOutputUsageId);
        const sourceStepId = stepIds.get(binding.sourceStepId);
        if (!bundleOutputUsageId || !sourceStepId) {
          throw new Error('cannot clone invalid final output binding');
        }
        return {
          ...binding,
          id: randomUUID(),
          bundleOutputUsageId,
          sourceStepId,
        };
      }),
    };

    await this.repository.createBundleVersion(structuredClone(draft));
    return draft;
  }
}
