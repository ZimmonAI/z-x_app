export type ReleaseStatus = 'draft' | 'published';
export type PackageValidationStatus = 'pending' | 'valid' | 'invalid';

export interface SemanticVersion {
  major: number;
  minor: number;
  patch: number;
}

export interface ManifestDefinition {
  id: string;
  manifestKey: string;
  displayName: string;
  description: string;
}

export interface ManifestVersion {
  id: string;
  manifestDefinitionId: string;
  version: SemanticVersion;
  valueKind: string;
  releaseStatus: ReleaseStatus;
}

export interface ScriptDefinition {
  id: string;
  scriptKey: string;
  displayName: string;
  description: string;
}

export interface RuntimePackage {
  id: string;
  storageObjectRef: string | null;
  checksumSha256: string | null;
  entrypoint: string | null;
  executable: boolean;
  validationStatus: PackageValidationStatus;
}

export interface ManifestUsage {
  id: string;
  manifestVersionId: string;
  usageKey: string;
  required: boolean;
  minItems: number;
  maxItems: number;
  sortOrder: number;
}

export interface ScriptVersion {
  id: string;
  scriptDefinitionId: string;
  version: SemanticVersion;
  runtimePackageId: string;
  runtimeFrameworkKey: string;
  releaseStatus: ReleaseStatus;
  inputUsages: ManifestUsage[];
  outputUsages: ManifestUsage[];
}

export interface BundleDefinition {
  id: string;
  bundleKey: string;
  displayName: string;
  description: string;
}

export type BundleManifestUsage = ManifestUsage;

export interface StepPolicy {
  maxAttempts: number;
  nextAttemptIntervalSeconds: number;
  maxScriptRuntimeSeconds: number;
  leaseSeconds: number;
}

export type StepInputBindingSource =
  | { kind: 'bundle-input'; bundleInputUsageId: string }
  | {
      kind: 'step-output';
      sourceStepId: string;
      sourceScriptOutputUsageId: string;
    }
  | { kind: 'fixed-value'; fixedValueId: string }
  | { kind: 'execution-context'; contextValueKey: string };

export interface StepInputBinding {
  id: string;
  targetScriptInputUsageId: string;
  bindingOrder: number;
  source: StepInputBindingSource;
}

export interface BundleStep {
  id: string;
  stepKey: string;
  displayName: string;
  stepOrder: number;
  scriptVersionId: string;
  tags: string[];
  policy: StepPolicy;
  inputBindings: StepInputBinding[];
}

export interface FinalOutputBinding {
  id: string;
  bundleOutputUsageId: string;
  sourceStepId: string;
  sourceScriptOutputUsageId: string;
}

export interface BundleVersion {
  id: string;
  bundleDefinitionId: string;
  version: SemanticVersion;
  releaseStatus: ReleaseStatus;
  inputUsages: BundleManifestUsage[];
  outputUsages: BundleManifestUsage[];
  steps: BundleStep[];
  finalOutputBindings: FinalOutputBinding[];
}

export interface CatalogSnapshot {
  manifestDefinitions: ManifestDefinition[];
  manifestVersions: ManifestVersion[];
  scriptDefinitions: ScriptDefinition[];
  runtimePackages: RuntimePackage[];
  scriptVersions: ScriptVersion[];
  bundleDefinitions: BundleDefinition[];
  bundleVersions: BundleVersion[];
}

export function semanticVersionKey(version: SemanticVersion): string {
  return `${version.major}.${version.minor}.${version.patch}`;
}
