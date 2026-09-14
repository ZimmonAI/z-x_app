import { randomUUID } from 'node:crypto';
import type {
  BundleVersion,
  CatalogSnapshot,
  ManifestUsage,
  ManifestVersion,
  RuntimePackage,
  ScriptVersion,
} from '../catalog/v1/types.js';
import { validateBundleVersion } from '../catalog/v1/validation.js';
import {
  ArtifactMetadataV1Schema,
  BundleOwnerExecutionV1Schema,
  BundleOwnerSubmitV1Schema,
  MAX_TEMP_ARTIFACT_BYTES,
  type ArtifactMetadataV1,
  type BundleManifestInputItemV1,
  type BundleOwnerExecutionV1,
  type BundleOwnerSubmitV1,
  type OwnerExecutionStatus,
} from '../contracts/v1/bundle-owner.js';

export interface BundleArtifactPayload {
  metadata: ArtifactMetadataV1;
  bytes: Uint8Array;
}

export interface BundleOwnerExecutionService {
  submit(
    ownerApp: string,
    input: unknown,
  ): Promise<{ code: 200 | 202; execution: BundleOwnerExecutionV1 }>;
  get(ownerApp: string, executionId: string): Promise<BundleOwnerExecutionV1 | null>;
  cancel(
    ownerApp: string,
    executionId: string,
  ): Promise<{ code: 200 | 202; execution: BundleOwnerExecutionV1 } | null>;
  retrieveArtifact(
    ownerApp: string,
    executionId: string,
    artifactId: string,
  ): Promise<BundleArtifactPayload | null>;
}

interface FrozenStepInstance {
  executionStepId: string;
  bundleStepId: string;
  stepKey: string;
  stepOrder: number;
  scriptVersionId: string;
  policy: BundleVersion['steps'][number]['policy'];
  inputBindings: BundleVersion['steps'][number]['inputBindings'];
  runtimeAffinityBindings: BundleVersion['steps'][number]['runtimeAffinityBindings'];
  status: 'pending';
}

export interface FrozenBundleActivation {
  bundleVersion: BundleVersion;
  manifestVersions: ManifestVersion[];
  scriptVersions: ScriptVersion[];
  runtimePackages: RuntimePackage[];
  manifestInputs: BundleOwnerSubmitV1['manifestInputs'];
  stepInstances: FrozenStepInstance[];
  finalOutputBindings: BundleVersion['finalOutputBindings'];
  controlContract: readonly ['DONE', 'POLLING', 'FAILED'];
}

interface InternalExecution {
  ownerApp: string;
  ownerActionId: string;
  ownerProjectId?: string;
  idempotencyKey: string;
  requestFingerprint: string;
  request: BundleOwnerSubmitV1;
  execution: BundleOwnerExecutionV1;
  frozenActivation: FrozenBundleActivation;
}

interface InternalArtifact extends BundleArtifactPayload {
  ownerApp: string;
  executionId: string;
}

function httpError(statusCode: number, message: string): never {
  throw Object.assign(new Error(message), { statusCode });
}

function cloneExecution(execution: BundleOwnerExecutionV1): BundleOwnerExecutionV1 {
  return structuredClone(execution);
}

function matchesManifestKind(valueKind: string, item: BundleManifestInputItemV1): boolean {
  const normalized = valueKind.toLowerCase();
  const resourceKind = normalized.endsWith('-resource')
    ? normalized.slice(0, -'-resource'.length)
    : normalized;
  if (['artifact', 'file', 'image', 'video', 'audio', 'binary'].includes(resourceKind)) {
    return (
      item.kind === 'artifact' &&
      (!item.mimeType ||
        resourceKind === 'artifact' ||
        resourceKind === 'file' ||
        item.mimeType.startsWith(`${resourceKind}/`))
    );
  }
  if (item.kind !== 'value') return false;
  if (['string', 'text', 'prompt', 'url', 'uri'].includes(normalized)) {
    return typeof item.value === 'string';
  }
  if (['number', 'float', 'double', 'decimal'].includes(normalized)) {
    return typeof item.value === 'number';
  }
  if (['integer', 'int'].includes(normalized)) {
    return typeof item.value === 'number' && Number.isInteger(item.value);
  }
  if (['boolean', 'bool'].includes(normalized)) return typeof item.value === 'boolean';
  if (['json', 'object'].includes(normalized)) {
    return item.value !== undefined && typeof item.value === 'object';
  }
  return true;
}

function validateUsageItems(
  usage: ManifestUsage,
  valueKind: string,
  items: BundleManifestInputItemV1[],
): void {
  if (items.length < usage.minItems || items.length > usage.maxItems) {
    httpError(400, `input ${usage.usageKey} violates cardinality ${usage.minItems}..${usage.maxItems}`);
  }
  if (!items.every((item) => matchesManifestKind(valueKind, item))) {
    httpError(400, `input ${usage.usageKey} violates manifest value kind ${valueKind}`);
  }
}

export class MemoryBundleOwnerExecutionService implements BundleOwnerExecutionService {
  private readonly rows = new Map<string, InternalExecution>();
  private readonly artifacts = new Map<string, InternalArtifact>();

  constructor(private readonly catalog: CatalogSnapshot) {}

  private activate(input: BundleOwnerSubmitV1): FrozenBundleActivation {
    const bundle = this.catalog.bundleVersions.find(
      (candidate) => candidate.id === input.bundleVersionId,
    );
    if (!bundle || bundle.releaseStatus !== 'published') {
      httpError(404, 'published bundle version not found');
    }
    const validation = validateBundleVersion(this.catalog, bundle);
    if (!validation.valid) {
      httpError(409, 'bundle version is not executable');
    }

    const declaredKeys = new Set(bundle.inputUsages.map((usage) => usage.usageKey));
    for (const suppliedKey of Object.keys(input.manifestInputs)) {
      if (!declaredKeys.has(suppliedKey)) {
        httpError(400, `undeclared bundle input: ${suppliedKey}`);
      }
    }

    const manifestVersions = new Map(
      this.catalog.manifestVersions.map((version) => [version.id, version]),
    );
    for (const usage of bundle.inputUsages) {
      const manifestVersion = manifestVersions.get(usage.manifestVersionId);
      if (!manifestVersion || manifestVersion.releaseStatus !== 'published') {
        httpError(409, `bundle input ${usage.usageKey} references unpublished manifest version`);
      }
      const items = input.manifestInputs[usage.usageKey] ?? [];
      validateUsageItems(usage, manifestVersion.valueKind, items);
    }

    const scriptVersions = new Map(
      this.catalog.scriptVersions.map((version) => [version.id, version]),
    );
    const runtimePackages = new Map(
      this.catalog.runtimePackages.map((runtimePackage) => [runtimePackage.id, runtimePackage]),
    );
    const frozenScripts: ScriptVersion[] = [];
    const frozenPackages: RuntimePackage[] = [];
    const manifestVersionIds = new Set<string>([
      ...bundle.inputUsages.map((usage) => usage.manifestVersionId),
      ...bundle.outputUsages.map((usage) => usage.manifestVersionId),
    ]);

    for (const step of bundle.steps) {
      const script = scriptVersions.get(step.scriptVersionId);
      if (!script || script.releaseStatus !== 'published') {
        httpError(409, 'bundle references unpublished script version');
      }
      const runtimePackage = runtimePackages.get(script.runtimePackageId);
      if (!runtimePackage || runtimePackage.validationStatus !== 'valid' || !runtimePackage.executable) {
        httpError(409, 'bundle references non-executable runtime package');
      }
      frozenScripts.push(script);
      frozenPackages.push(runtimePackage);
      for (const usage of [...script.inputUsages, ...script.outputUsages]) {
        manifestVersionIds.add(usage.manifestVersionId);
      }
    }

    const frozenManifests = [...manifestVersionIds].map((id) => {
      const manifest = manifestVersions.get(id);
      if (!manifest || manifest.releaseStatus !== 'published') {
        httpError(409, 'bundle activation references unpublished manifest version');
      }
      return manifest;
    });

    const stepInstances: FrozenStepInstance[] = [...bundle.steps]
      .sort((left, right) => left.stepOrder - right.stepOrder)
      .map((step) => ({
        executionStepId: randomUUID(),
        bundleStepId: step.id,
        stepKey: step.stepKey,
        stepOrder: step.stepOrder,
        scriptVersionId: step.scriptVersionId,
        policy: structuredClone(step.policy),
        inputBindings: structuredClone(step.inputBindings),
        runtimeAffinityBindings: structuredClone(step.runtimeAffinityBindings),
        status: 'pending',
      }));

    return structuredClone({
      bundleVersion: bundle,
      manifestVersions: frozenManifests,
      scriptVersions: frozenScripts,
      runtimePackages: frozenPackages,
      manifestInputs: input.manifestInputs,
      stepInstances,
      finalOutputBindings: bundle.finalOutputBindings,
      controlContract: ['DONE', 'POLLING', 'FAILED'] as const,
    });
  }

  async submit(
    ownerApp: string,
    raw: unknown,
  ): Promise<{ code: 200 | 202; execution: BundleOwnerExecutionV1 }> {
    const input = BundleOwnerSubmitV1Schema.parse(raw);
    if (input.ownerApp !== ownerApp) {
      httpError(403, 'owner mismatch');
    }
    for (const row of this.rows.values()) {
      if (row.ownerApp === ownerApp && row.idempotencyKey === input.idempotencyKey) {
        if (row.requestFingerprint !== input.requestFingerprint) {
          httpError(409, 'idempotency conflict');
        }
        return { code: 200, execution: cloneExecution(row.execution) };
      }
    }

    const frozenActivation = this.activate(input);
    const now = new Date().toISOString();
    const execution: BundleOwnerExecutionV1 = {
      contractVersion: 'zx.bundle-owner.v1',
      executionId: randomUUID(),
      status: 'accepted',
      outputs: [],
      createdAt: now,
      updatedAt: now,
    };
    this.rows.set(execution.executionId, {
      ownerApp,
      ownerActionId: input.ownerActionId,
      ...(input.ownerProjectId ? { ownerProjectId: input.ownerProjectId } : {}),
      idempotencyKey: input.idempotencyKey,
      requestFingerprint: input.requestFingerprint,
      request: structuredClone(input),
      execution,
      frozenActivation,
    });
    return { code: 202, execution: cloneExecution(execution) };
  }

  async get(ownerApp: string, executionId: string): Promise<BundleOwnerExecutionV1 | null> {
    const row = this.rows.get(executionId);
    return row?.ownerApp === ownerApp ? cloneExecution(row.execution) : null;
  }

  async cancel(
    ownerApp: string,
    executionId: string,
  ): Promise<{ code: 200 | 202; execution: BundleOwnerExecutionV1 } | null> {
    const row = this.rows.get(executionId);
    if (!row || row.ownerApp !== ownerApp) return null;
    if (['succeeded', 'failed', 'cancelled', 'timed-out'].includes(row.execution.status)) {
      return { code: 200, execution: cloneExecution(row.execution) };
    }
    const now = new Date().toISOString();
    row.execution = { ...row.execution, status: 'cancelled', updatedAt: now, terminalAt: now };
    return { code: 202, execution: cloneExecution(row.execution) };
  }

  async retrieveArtifact(
    ownerApp: string,
    executionId: string,
    artifactId: string,
  ): Promise<BundleArtifactPayload | null> {
    const row = this.rows.get(executionId);
    if (!row || row.ownerApp !== ownerApp || row.execution.status !== 'succeeded') return null;
    const visibleOutput = row.execution.outputs.some(
      (output) => output.artifact?.artifactId === artifactId,
    );
    if (!visibleOutput) return null;
    const artifact = this.artifacts.get(artifactId);
    if (!artifact || artifact.ownerApp !== ownerApp || artifact.executionId !== executionId) return null;
    if (Date.parse(artifact.metadata.expiresAt) <= Date.now()) {
      httpError(410, 'artifact expired');
    }
    if (
      artifact.metadata.sizeBytes > MAX_TEMP_ARTIFACT_BYTES ||
      artifact.bytes.byteLength !== artifact.metadata.sizeBytes
    ) {
      httpError(409, 'artifact size policy violation');
    }
    return { metadata: structuredClone(artifact.metadata), bytes: artifact.bytes.slice() };
  }

  seedTerminalResultForTest(input: {
    ownerApp: string;
    executionId: string;
    status: Extract<OwnerExecutionStatus, 'succeeded' | 'failed'>;
    outputs?: BundleOwnerExecutionV1['outputs'];
    failure?: BundleOwnerExecutionV1['failure'];
  }): void {
    const row = this.rows.get(input.executionId);
    if (!row || row.ownerApp !== input.ownerApp) throw new Error('execution not found');
    const now = new Date().toISOString();
    row.execution = BundleOwnerExecutionV1Schema.parse({
      ...row.execution,
      status: input.status,
      outputs: structuredClone(input.outputs ?? []),
      ...(input.failure ? { failure: structuredClone(input.failure) } : {}),
      updatedAt: now,
      terminalAt: now,
    });
  }

  seedArtifactForTest(input: InternalArtifact): void {
    const metadata = ArtifactMetadataV1Schema.parse(input.metadata);
    if (input.bytes.byteLength !== metadata.sizeBytes) {
      throw new Error('artifact bytes do not match declared size');
    }
    this.artifacts.set(metadata.artifactId, {
      ...input,
      metadata,
      bytes: input.bytes.slice(),
    });
  }

  inspectFrozenActivationForTest(
    ownerApp: string,
    executionId: string,
  ): FrozenBundleActivation | null {
    const row = this.rows.get(executionId);
    return row?.ownerApp === ownerApp ? structuredClone(row.frozenActivation) : null;
  }
}

function unavailable(): Promise<never> {
  return Promise.reject(
    Object.assign(new Error('immutable bundle runtime is not yet available'), { statusCode: 503 }),
  );
}

export class UnavailableBundleOwnerExecutionService implements BundleOwnerExecutionService {
  submit(): Promise<never> {
    return unavailable();
  }

  async get(): Promise<null> {
    return null;
  }

  async cancel(): Promise<null> {
    return null;
  }

  async retrieveArtifact(): Promise<null> {
    return null;
  }
}
