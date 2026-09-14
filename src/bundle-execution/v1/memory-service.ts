import { createHash, randomUUID } from 'node:crypto';
import type { CatalogSnapshot, ManifestUsage } from '../../catalog/v1/types.js';
import {
  BundleExecutionViewV1Schema,
  type BundleExecutionRequestV1,
  type BundleExecutionViewV1,
  type FinalOutputItemV1,
  type FinalOutputV1,
  type TemporaryArtifactDescriptorV1,
} from '../../contracts/bundle-owner/v1/execution.js';
import { validateBundleExecutionRequest } from '../../validation/bundle-owner-request.js';
import { activatePublishedBundle, type FrozenBundleActivation } from './activation.js';
import type {
  BundleArtifactRead,
  BundleExecutionSubmitResult,
  BundleOwnerExecutionService,
} from './service.js';

interface InternalExecution {
  ownerApp: string;
  idempotencyKey: string;
  fingerprint: string;
  request: BundleExecutionRequestV1;
  frozen: FrozenBundleActivation;
  view: BundleExecutionViewV1;
}

interface InternalArtifact {
  ownerApp: string;
  executionId: string;
  manifestKey: string;
  descriptor: TemporaryArtifactDescriptorV1;
  bytes: Buffer;
}

interface ResolvedOutputUsage {
  usage: ManifestUsage;
  manifestKey: string;
  valueKind: string;
}

export type FixtureOutputItem =
  | { kind: 'value'; value: unknown }
  | {
      kind: 'artifact';
      bytes: Buffer;
      mimeType: string;
      fileNameHint?: string;
      expiresAt?: string;
    };

function conflict(message: string): never {
  throw Object.assign(new Error(message), { statusCode: 409 });
}

function fixtureError(message: string): never {
  throw new Error(message);
}

function cloneView(view: BundleExecutionViewV1): BundleExecutionViewV1 {
  return structuredClone(view);
}

function resolveOutputUsages(
  snapshot: CatalogSnapshot,
  activation: FrozenBundleActivation,
): Map<string, ResolvedOutputUsage> {
  const versions = new Map(snapshot.manifestVersions.map((version) => [version.id, version]));
  const definitions = new Map(
    snapshot.manifestDefinitions.map((definition) => [definition.id, definition]),
  );
  const result = new Map<string, ResolvedOutputUsage>();
  for (const usage of activation.bundle.outputUsages) {
    const version = versions.get(usage.manifestVersionId);
    const definition = version ? definitions.get(version.manifestDefinitionId) : undefined;
    if (!version || !definition) fixtureError('fixture output manifest is missing');
    if (result.has(definition.manifestKey)) fixtureError('fixture output manifest key is ambiguous');
    result.set(definition.manifestKey, {
      usage,
      manifestKey: definition.manifestKey,
      valueKind: version.valueKind.toLowerCase(),
    });
  }
  return result;
}

function outputKindMatches(item: FixtureOutputItem, valueKind: string): boolean {
  const resource =
    valueKind.includes('resource') ||
    valueKind.includes('image') ||
    valueKind.includes('video') ||
    valueKind.includes('binary') ||
    valueKind.includes('file');
  if (resource) {
    if (item.kind !== 'artifact') return false;
    if (valueKind.includes('image')) return item.mimeType.startsWith('image/');
    if (valueKind.includes('video')) return item.mimeType.startsWith('video/');
    return true;
  }
  if (item.kind !== 'value') return false;
  if (valueKind === 'text' || valueKind === 'string') return typeof item.value === 'string';
  if (valueKind === 'number') return typeof item.value === 'number' && Number.isFinite(item.value);
  if (valueKind === 'integer') return typeof item.value === 'number' && Number.isInteger(item.value);
  if (valueKind === 'boolean') return typeof item.value === 'boolean';
  return ['json', 'structured', 'object'].includes(valueKind);
}

export class MemoryBundleOwnerExecutionService implements BundleOwnerExecutionService {
  private readonly snapshot: CatalogSnapshot;
  private readonly executions = new Map<string, InternalExecution>();
  private readonly idempotency = new Map<string, string>();
  private readonly artifacts = new Map<string, InternalArtifact>();

  constructor(
    snapshot: CatalogSnapshot,
    private readonly now: () => Date = () => new Date(),
  ) {
    this.snapshot = structuredClone(snapshot);
  }

  async submit(ownerApp: string, input: unknown): Promise<BundleExecutionSubmitResult> {
    const request = validateBundleExecutionRequest(input);
    const idempotencyKey = `${ownerApp}\u0000${request.idempotencyKey}`;
    const existingId = this.idempotency.get(idempotencyKey);
    if (existingId) {
      const existing = this.executions.get(existingId);
      if (!existing) fixtureError('fixture idempotency index is corrupt');
      if (existing.fingerprint !== request.requestFingerprint) {
        conflict('ZX_IDEMPOTENCY_CONFLICT');
      }
      return { code: 200, execution: cloneView(existing.view) };
    }

    const frozen = activatePublishedBundle(this.snapshot, request);
    const executionId = randomUUID();
    const timestamp = this.now().toISOString();
    const view = BundleExecutionViewV1Schema.parse({
      contractVersion: 'zx.bundle-owner.execution.v1',
      executionId,
      bundleVersionId: request.bundleVersionId,
      ownerRef: request.ownerRef,
      state: 'accepted',
      outputs: [],
      createdAt: timestamp,
      updatedAt: timestamp,
    });
    this.executions.set(executionId, {
      ownerApp,
      idempotencyKey: request.idempotencyKey,
      fingerprint: request.requestFingerprint,
      request: structuredClone(request),
      frozen,
      view,
    });
    this.idempotency.set(idempotencyKey, executionId);
    return { code: 202, execution: cloneView(view) };
  }

  async get(ownerApp: string, executionId: string): Promise<BundleExecutionViewV1 | null> {
    const record = this.executions.get(executionId);
    if (!record || record.ownerApp !== ownerApp) return null;
    return cloneView(record.view);
  }

  async readArtifact(
    ownerApp: string,
    executionId: string,
    artifactRef: string,
  ): Promise<BundleArtifactRead | null> {
    const execution = this.executions.get(executionId);
    const artifact = this.artifacts.get(artifactRef);
    if (
      !execution ||
      execution.ownerApp !== ownerApp ||
      !artifact ||
      artifact.ownerApp !== ownerApp ||
      artifact.executionId !== executionId
    ) {
      return null;
    }
    if (Date.parse(artifact.descriptor.expiresAt) <= this.now().getTime()) {
      throw Object.assign(new Error('ZX_ARTIFACT_EXPIRED'), { statusCode: 410 });
    }
    return {
      descriptor: structuredClone(artifact.descriptor),
      bytes: Buffer.from(artifact.bytes),
    };
  }

  completeForFixture(
    executionId: string,
    outputItems: Record<string, FixtureOutputItem[]>,
  ): BundleExecutionViewV1 {
    const record = this.executions.get(executionId);
    if (!record) fixtureError('fixture execution was not found');
    if (['succeeded', 'failed', 'cancelled'].includes(record.view.state)) return cloneView(record.view);

    const expected = resolveOutputUsages(this.snapshot, record.frozen);
    for (const manifestKey of Object.keys(outputItems)) {
      if (!expected.has(manifestKey)) fixtureError(`unknown fixture output ${manifestKey}`);
    }

    const outputs: FinalOutputV1[] = [];
    for (const resolved of expected.values()) {
      const items = outputItems[resolved.manifestKey] ?? [];
      if (items.length < resolved.usage.minItems || items.length > resolved.usage.maxItems) {
        fixtureError(`invalid fixture output cardinality for ${resolved.manifestKey}`);
      }
      if (items.some((item) => !outputKindMatches(item, resolved.valueKind))) {
        fixtureError(`invalid fixture output type for ${resolved.manifestKey}`);
      }
      const normalizedItems: FinalOutputItemV1[] = items.map((item) => {
        if (item.kind === 'value') return { kind: 'value', value: structuredClone(item.value) };
        const artifactRef = randomUUID();
        const checksum = createHash('sha256').update(item.bytes).digest('hex');
        const descriptor: TemporaryArtifactDescriptorV1 = {
          artifactRef,
          mimeType: item.mimeType,
          sizeBytes: item.bytes.byteLength,
          checksumSha256: checksum,
          ...(item.fileNameHint ? { fileNameHint: item.fileNameHint } : {}),
          expiresAt:
            item.expiresAt ?? new Date(this.now().getTime() + 5 * 60_000).toISOString(),
        };
        this.artifacts.set(artifactRef, {
          ownerApp: record.ownerApp,
          executionId,
          manifestKey: resolved.manifestKey,
          descriptor,
          bytes: Buffer.from(item.bytes),
        });
        return { kind: 'temporary-artifact', artifact: descriptor };
      });
      outputs.push({
        manifestKey: resolved.manifestKey,
        usageKey: resolved.usage.usageKey,
        items: normalizedItems,
      });
    }

    const terminalAt = this.now().toISOString();
    record.view = BundleExecutionViewV1Schema.parse({
      ...record.view,
      state: 'succeeded',
      outputs,
      updatedAt: terminalAt,
      terminalAt,
    });
    return cloneView(record.view);
  }

  failForFixture(executionId: string, code: string, message: string): BundleExecutionViewV1 {
    const record = this.executions.get(executionId);
    if (!record) fixtureError('fixture execution was not found');
    if (['succeeded', 'failed', 'cancelled'].includes(record.view.state)) return cloneView(record.view);
    const terminalAt = this.now().toISOString();
    record.view = BundleExecutionViewV1Schema.parse({
      ...record.view,
      state: 'failed',
      outputs: [],
      failure: { code, message },
      updatedAt: terminalAt,
      terminalAt,
    });
    return cloneView(record.view);
  }

  frozenActivationForFixture(executionId: string): FrozenBundleActivation | null {
    const record = this.executions.get(executionId);
    return record ? structuredClone(record.frozen) : null;
  }
}
