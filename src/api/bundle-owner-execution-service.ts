import { randomUUID } from 'node:crypto';
import type { CatalogSnapshot, ManifestUsage } from '../catalog/v1/types.js';
import { validateBundleVersion } from '../catalog/v1/validation.js';
import {
  ArtifactMetadataV1Schema,
  BundleOwnerSubmitV1Schema,
  type ArtifactMetadataV1,
  type BundleInputItemV1,
  type BundleOwnerExecutionV1,
  type BundleOwnerSubmitV1,
  type OwnerExecutionState,
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

interface InternalExecution {
  ownerApp: string;
  ownerRef: string;
  idempotencyKey: string;
  requestFingerprint: string;
  request: BundleOwnerSubmitV1;
  execution: BundleOwnerExecutionV1;
  frozenActivation: unknown;
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

function matchesManifestKind(valueKind: string, item: BundleInputItemV1): boolean {
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
  items: BundleInputItemV1[],
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

  private activate(input: BundleOwnerSubmitV1): unknown {
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
    for (const suppliedKey of Object.keys(input.inputs)) {
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
      const items = input.inputs[usage.usageKey] ?? [];
      validateUsageItems(usage, manifestVersion.valueKind, items);
    }

    const scriptVersions = new Map(
      this.catalog.scriptVersions.map((version) => [version.id, version]),
    );
    const runtimePackages = new Map(
      this.catalog.runtimePackages.map((runtimePackage) => [runtimePackage.id, runtimePackage]),
    );
    for (const step of bundle.steps) {
      const script = scriptVersions.get(step.scriptVersionId);
      if (!script || script.releaseStatus !== 'published') {
        httpError(409, 'bundle references unpublished script version');
      }
      const runtimePackage = runtimePackages.get(script.runtimePackageId);
      if (!runtimePackage || runtimePackage.validationStatus !== 'valid' || !runtimePackage.executable) {
        httpError(409, 'bundle references non-executable runtime package');
      }
    }

    return structuredClone({
      bundleVersion: bundle,
      manifests: bundle.inputUsages.map((usage) => manifestVersions.get(usage.manifestVersionId)),
      scripts: bundle.steps.map((step) => scriptVersions.get(step.scriptVersionId)),
      inputs: input.inputs,
    });
  }

  async submit(
    ownerApp: string,
    raw: unknown,
  ): Promise<{ code: 200 | 202; execution: BundleOwnerExecutionV1 }> {
    const input = BundleOwnerSubmitV1Schema.parse(raw);
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
      state: 'accepted',
      outputs: [],
      createdAt: now,
      updatedAt: now,
    };
    this.rows.set(execution.executionId, {
      ownerApp,
      ownerRef: input.ownerRef,
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
    if (['succeeded', 'failed', 'cancelled', 'timed-out'].includes(row.execution.state)) {
      return { code: 200, execution: cloneExecution(row.execution) };
    }
    const now = new Date().toISOString();
    row.execution = { ...row.execution, state: 'cancelled', updatedAt: now, terminalAt: now };
    return { code: 202, execution: cloneExecution(row.execution) };
  }

  async retrieveArtifact(
    ownerApp: string,
    executionId: string,
    artifactId: string,
  ): Promise<BundleArtifactPayload | null> {
    const row = this.rows.get(executionId);
    if (!row || row.ownerApp !== ownerApp || row.execution.state !== 'succeeded') return null;
    const visibleOutput = row.execution.outputs.some(
      (output) => output.artifact?.artifactId === artifactId,
    );
    if (!visibleOutput) return null;
    const artifact = this.artifacts.get(artifactId);
    if (!artifact || artifact.ownerApp !== ownerApp || artifact.executionId !== executionId) return null;
    if (Date.parse(artifact.metadata.expiresAt) <= Date.now()) {
      httpError(410, 'artifact expired');
    }
    return { metadata: structuredClone(artifact.metadata), bytes: artifact.bytes.slice() };
  }

  seedTerminalResultForTest(input: {
    ownerApp: string;
    executionId: string;
    state: Extract<OwnerExecutionState, 'succeeded' | 'failed'>;
    outputs?: BundleOwnerExecutionV1['outputs'];
    failure?: BundleOwnerExecutionV1['failure'];
  }): void {
    const row = this.rows.get(input.executionId);
    if (!row || row.ownerApp !== input.ownerApp) throw new Error('execution not found');
    const now = new Date().toISOString();
    row.execution = {
      ...row.execution,
      state: input.state,
      outputs: structuredClone(input.outputs ?? []),
      ...(input.failure ? { failure: structuredClone(input.failure) } : {}),
      updatedAt: now,
      terminalAt: now,
    };
  }

  seedArtifactForTest(input: InternalArtifact): void {
    ArtifactMetadataV1Schema.parse(input.metadata);
    this.artifacts.set(input.metadata.artifactId, { ...input, bytes: input.bytes.slice() });
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

  get(): Promise<never> {
    return unavailable();
  }

  cancel(): Promise<never> {
    return unavailable();
  }

  retrieveArtifact(): Promise<never> {
    return unavailable();
  }
}
