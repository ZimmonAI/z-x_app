import { validateRuntimeAffinityBindings } from '../../catalog/v1/runtime-affinity.js';
import type {
  BundleVersion,
  CatalogSnapshot,
  ManifestUsage,
  ManifestVersion,
  RuntimePackage,
  ScriptVersion,
} from '../../catalog/v1/types.js';
import { validateBundleVersion } from '../../catalog/v1/validation.js';
import type {
  BundleExecutionRequestV1,
  BundleInputItemV1,
} from '../../contracts/bundle-owner/v1/execution.js';

export interface FrozenBundleActivation {
  bundle: BundleVersion;
  scriptVersions: ScriptVersion[];
  manifestVersions: ManifestVersion[];
  runtimePackages: RuntimePackage[];
}

interface ResolvedInputUsage {
  usage: ManifestUsage;
  manifestKey: string;
  valueKind: string;
}

function reject(message: string, statusCode: number): never {
  throw Object.assign(new Error(message), { statusCode });
}

function resolveInputUsages(
  snapshot: CatalogSnapshot,
  bundle: BundleVersion,
): Map<string, ResolvedInputUsage> {
  const versions = new Map(snapshot.manifestVersions.map((version) => [version.id, version]));
  const definitions = new Map(
    snapshot.manifestDefinitions.map((definition) => [definition.id, definition]),
  );
  const resolved = new Map<string, ResolvedInputUsage>();

  for (const usage of bundle.inputUsages) {
    const version = versions.get(usage.manifestVersionId);
    const definition = version ? definitions.get(version.manifestDefinitionId) : undefined;
    if (!version || !definition) reject('ZX_BUNDLE_NOT_EXECUTABLE', 422);
    if (resolved.has(definition.manifestKey)) reject('ZX_BUNDLE_INPUT_AMBIGUOUS', 422);
    resolved.set(definition.manifestKey, {
      usage,
      manifestKey: definition.manifestKey,
      valueKind: version.valueKind,
    });
  }
  return resolved;
}

function itemMatchesValueKind(item: BundleInputItemV1, rawValueKind: string): boolean {
  const valueKind = rawValueKind.trim().toLowerCase();
  if (
    valueKind.includes('image') ||
    valueKind.includes('video') ||
    valueKind.includes('resource') ||
    valueKind.includes('binary') ||
    valueKind.includes('file')
  ) {
    if (item.kind !== 'resource') return false;
    if (valueKind.includes('image')) return item.mimeType?.startsWith('image/') === true;
    if (valueKind.includes('video')) return item.mimeType?.startsWith('video/') === true;
    return true;
  }
  if (valueKind === 'text' || valueKind === 'string') {
    return item.kind === 'value' && typeof item.value === 'string';
  }
  if (valueKind === 'number') {
    return item.kind === 'value' && typeof item.value === 'number';
  }
  if (valueKind === 'integer') {
    return item.kind === 'value' && typeof item.value === 'number' && Number.isInteger(item.value);
  }
  if (valueKind === 'boolean') {
    return item.kind === 'value' && typeof item.value === 'boolean';
  }
  if (['json', 'structured', 'object'].includes(valueKind)) {
    return item.kind === 'value';
  }
  reject('ZX_BUNDLE_MANIFEST_VALUE_KIND_UNSUPPORTED', 422);
}

function validateInputs(
  snapshot: CatalogSnapshot,
  bundle: BundleVersion,
  request: BundleExecutionRequestV1,
): void {
  const expected = resolveInputUsages(snapshot, bundle);
  for (const manifestKey of Object.keys(request.inputs)) {
    if (!expected.has(manifestKey)) reject('ZX_BUNDLE_INPUT_UNKNOWN', 400);
  }

  for (const resolved of expected.values()) {
    const items = request.inputs[resolved.manifestKey] ?? [];
    if (items.length < resolved.usage.minItems || items.length > resolved.usage.maxItems) {
      reject('ZX_BUNDLE_INPUT_CARDINALITY', 400);
    }
    if (items.some((item) => !itemMatchesValueKind(item, resolved.valueKind))) {
      reject('ZX_BUNDLE_INPUT_TYPE_MISMATCH', 400);
    }
  }
}

function freezeCatalogGraph(snapshot: CatalogSnapshot, bundle: BundleVersion): FrozenBundleActivation {
  const scriptIds = new Set(bundle.steps.map((step) => step.scriptVersionId));
  const scriptVersions = snapshot.scriptVersions.filter((script) => scriptIds.has(script.id));
  const packageIds = new Set(scriptVersions.map((script) => script.runtimePackageId));
  const runtimePackages = snapshot.runtimePackages.filter((runtimePackage) =>
    packageIds.has(runtimePackage.id),
  );
  const manifestIds = new Set([
    ...bundle.inputUsages.map((usage) => usage.manifestVersionId),
    ...bundle.outputUsages.map((usage) => usage.manifestVersionId),
    ...scriptVersions.flatMap((script) => [
      ...script.inputUsages.map((usage) => usage.manifestVersionId),
      ...script.outputUsages.map((usage) => usage.manifestVersionId),
    ]),
  ]);
  const manifestVersions = snapshot.manifestVersions.filter((version) => manifestIds.has(version.id));
  return structuredClone({ bundle, scriptVersions, manifestVersions, runtimePackages });
}

export function activatePublishedBundle(
  snapshot: CatalogSnapshot,
  request: BundleExecutionRequestV1,
): FrozenBundleActivation {
  const bundle = snapshot.bundleVersions.find((candidate) => candidate.id === request.bundleVersionId);
  if (!bundle) reject('ZX_BUNDLE_NOT_FOUND', 404);
  if (bundle.releaseStatus !== 'published') reject('ZX_BUNDLE_NOT_PUBLISHED', 422);

  const bundleValidation = validateBundleVersion(snapshot, bundle);
  const affinityValidation = validateRuntimeAffinityBindings(bundle);
  if (!bundleValidation.valid || !affinityValidation.valid) {
    reject('ZX_BUNDLE_NOT_EXECUTABLE', 422);
  }

  validateInputs(snapshot, bundle, request);
  return freezeCatalogGraph(snapshot, bundle);
}
