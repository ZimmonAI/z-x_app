import type { TemporaryArtifactClient } from '../artifacts/temporary.js';
import type { AutoHubDispatchClient } from '../clients/auto-hub.js';
import type {
  DelegatedStorageResultV1,
  ExactObjectReadResultV1,
  ZStorageClient,
} from '../clients/z-s.js';
import type {
  CapacitySnapshotV1,
  FixtureScenario,
  PreparedExecutionInputV1,
  RouteSnapshotV1,
  StorageResultV1,
} from '../contracts/v1/dependencies.js';
import { SafeExecutionError } from '../contracts/v1/error.js';
import {
  getDelegatedAuthorityReference,
  type ExecutionRequestV1,
  type OperationType,
} from '../contracts/v1/execution.js';
import type { OwnerCorrelatedStorageOutputV1 } from '../contracts/v1/result.js';
import { validateGeneratedMedia } from '../validation/output.js';

export const DELEGATED_OUTPUT_WRITE_AUTHORITY_NAME = 'output.primary.write' as const;
const FIXTURE_SCENARIOS = new Set<FixtureScenario>([
  'success',
  'route-not-found',
  'route-deactivated',
  'invalid-parameters',
  'no-capacity',
  'login-required',
  'account-attention',
  'provider-rejected',
  'timeout',
  'malformed-output',
  'storage-failure',
  'callback-failure',
  'unknown-run',
]);

export interface AdapterContext {
  request: ExecutionRequestV1;
  route: RouteSnapshotV1;
  capacity: CapacitySnapshotV1;
  executionId: string;
  attemptId: string;
  signal: AbortSignal;
  autoHub: AutoHubDispatchClient;
  storage: ZStorageClient;
  temporaryArtifacts?: TemporaryArtifactClient;
  recordProviderOutput(input: {
    externalRunRef?: string;
    safeProviderOutputRef?: string;
  }): Promise<void>;
  /**
   * Compatibility persistence slot. For delegated Z-s writes this stores only the
   * public exact write-intent identity. The bounded capability stays frozen in the
   * immutable request and is never copied into attempt/result metadata.
   */
  recordOutputAuthorization(authorizationRef: string): Promise<void>;
}

export interface AdapterOutput {
  promptText?: string;
  media?: StorageResultV1 | OwnerCorrelatedStorageOutputV1;
  externalRunRef?: string;
  safeProviderOutputRef?: string;
}

export interface ExecutionAdapter {
  readonly operation: OperationType;
  readonly id: string;
  readonly version: '1.0.0';
  execute(context: AdapterContext): Promise<AdapterOutput>;
}

export function fixtureScenario(request: ExecutionRequestV1): FixtureScenario | undefined {
  const value = request.safeScalarInputs.fixtureScenario;
  return typeof value === 'string' && FIXTURE_SCENARIOS.has(value as FixtureScenario)
    ? (value as FixtureScenario)
    : undefined;
}

export function requiredScalarString(request: ExecutionRequestV1, key: string): string {
  const value = request.safeScalarInputs[key];
  if (typeof value !== 'string' || !value.trim()) {
    throw new SafeExecutionError({
      family: 'invalid-owner-request',
      code: 'ZX_REQUIRED_SCALAR_MISSING',
      message: `required scalar ${key} is missing`,
      retryable: false,
      details: { key },
      traceId: request.traceId,
    });
  }
  return value;
}

export async function consumeFrozenExactObject(
  context: Pick<AdapterContext, 'request' | 'storage' | 'executionId' | 'attemptId' | 'signal'>,
  input: Readonly<{
    resourceId: string;
    resourceVersionId?: string;
    storageObjectId?: string;
    kind: string;
    role?: string;
    readGrantRef?: string;
  }>,
): Promise<PreparedExecutionInputV1> {
  if (!input.storageObjectId || !input.readGrantRef) {
    throw new SafeExecutionError({
      family: 'invalid-owner-request',
      code: 'ZX_EXACT_INPUT_AUTHORITY_REQUIRED',
      message: 'the exact input object and bounded read authority are required',
      retryable: false,
      traceId: context.request.traceId,
    });
  }
  if (context.storage.readExactObject === undefined) {
    throw new SafeExecutionError({
      family: 'adapter-unavailable',
      code: 'ZX_Z_S_EXACT_INPUT_READER_UNAVAILABLE',
      message: 'the governed Z-s exact-object input reader is unavailable',
      retryable: true,
      traceId: context.request.traceId,
    });
  }
  const exact = await context.storage.readExactObject(
    {
      executionId: context.executionId,
      attemptId: context.attemptId,
      storageObjectId: input.storageObjectId,
      readAuthorityRef: input.readGrantRef,
    },
    context.signal,
  );
  if (exact.storageObjectId !== input.storageObjectId) {
    throw new SafeExecutionError({
      family: 'storage-input-failure',
      code: 'ZX_Z_S_INPUT_IDENTITY_CHANGED',
      message: 'the exact Z-s input identity changed during delegated read',
      retryable: false,
      traceId: context.request.traceId,
    });
  }
  return Object.freeze({
    resourceId: input.resourceId,
    ...(input.resourceVersionId === undefined ? {} : { resourceVersionId: input.resourceVersionId }),
    storageObjectId: exact.storageObjectId,
    kind: input.kind,
    ...(input.role === undefined ? {} : { role: input.role }),
    mimeType: exact.mimeType,
    sizeBytes: exact.sizeBytes,
    checksumSha256: exact.checksumSha256,
    body: exact.body,
  });
}

export async function consumeDelegatedExactObject(
  context: Pick<AdapterContext, 'request' | 'storage' | 'executionId' | 'attemptId' | 'signal'>,
  input: Readonly<{ authorityName: string; storageObjectId: string }>,
): Promise<ExactObjectReadResultV1> {
  const authorityRef = getDelegatedAuthorityReference(context.request, input.authorityName);
  if (authorityRef === undefined) {
    throw new SafeExecutionError({
      family: 'invalid-owner-request',
      code: 'ZX_DELEGATED_INPUT_AUTHORITY_REQUIRED',
      message: 'the execution is missing the delegated authority for the exact input object',
      retryable: false,
      details: { authorityName: input.authorityName },
      traceId: context.request.traceId,
    });
  }
  if (context.storage.readExactObject === undefined) {
    throw new SafeExecutionError({
      family: 'adapter-unavailable',
      code: 'ZX_Z_S_EXACT_INPUT_READER_UNAVAILABLE',
      message: 'the governed Z-s exact-object input reader is unavailable',
      retryable: true,
      traceId: context.request.traceId,
    });
  }
  return context.storage.readExactObject(
    {
      executionId: context.executionId,
      attemptId: context.attemptId,
      storageObjectId: input.storageObjectId,
      readAuthorityRef: authorityRef,
    },
    context.signal,
  );
}

export function delegatedOutputWriteAuthority(request: ExecutionRequestV1): string {
  const authority =
    getDelegatedAuthorityReference(request, DELEGATED_OUTPUT_WRITE_AUTHORITY_NAME) ??
    request.ownerStorageAccess?.outputWriteGrantRef;
  if (!authority) {
    throw new SafeExecutionError({
      family: 'invalid-owner-request',
      code: 'ZX_Z_S_OUTPUT_AUTHORITY_REQUIRED',
      message: 'the bounded owner-authorized Z-s output authority is required',
      retryable: false,
      traceId: request.traceId,
    });
  }
  return authority;
}

export function ownerCorrelatedDelegatedStorageResult(
  request: ExecutionRequestV1,
  result: Readonly<DelegatedStorageResultV1>,
  kind: 'image' | 'video',
): OwnerCorrelatedStorageOutputV1 {
  const ownerStorageAccess = request.ownerStorageAccess;
  if (!ownerStorageAccess) {
    throw new SafeExecutionError({
      family: 'invalid-owner-request',
      code: 'ZX_OWNER_STORAGE_ACCESS_REQUIRED',
      message: 'owner-issued storage access is required for delegated output handoff',
      retryable: false,
      traceId: request.traceId,
    });
  }
  if (result.mimeType !== request.requestedOutputType) {
    throw new SafeExecutionError({
      family: 'malformed-output',
      code: 'ZX_Z_S_OUTPUT_MIME_MISMATCH',
      message: 'the durable Z-s output MIME did not match the frozen execution request',
      retryable: false,
      traceId: request.traceId,
    });
  }
  if (result.width === undefined || result.height === undefined) {
    throw new SafeExecutionError({
      family: 'malformed-output',
      code: 'ZX_MEDIA_DIMENSIONS_MISSING',
      message: 'stored media dimensions are missing',
      retryable: true,
      traceId: request.traceId,
    });
  }
  validateGeneratedMedia(kind, {
    mimeType: result.mimeType,
    sizeBytes: result.sizeBytes,
    width: result.width,
    height: result.height,
    checksumSha256: result.checksumSha256,
    storageIdentity: `zs://storage-objects/${result.storageObjectId}`,
    ...(result.durationSeconds === undefined ? {} : { durationSeconds: result.durationSeconds }),
  });
  return {
    pendingResourceId: ownerStorageAccess.pendingResourceId,
    storageObjectId: result.storageObjectId,
    checksumSha256: result.checksumSha256,
    mimeType: result.mimeType,
    sizeBytes: result.sizeBytes,
    width: result.width,
    height: result.height,
    ...(result.durationSeconds === undefined ? {} : { durationSeconds: result.durationSeconds }),
  };
}

async function runProvider(
  context: AdapterContext,
  scenario: FixtureScenario | undefined,
  preparedInputs: readonly PreparedExecutionInputV1[] = [],
) {
  const started = await context.autoHub.startRun(
    {
      operation: context.request.operationType,
      adapterId: context.route.adapterId,
      runtimeBindingRef: context.capacity.runtimeBindingRef,
      ...(preparedInputs.length === 0 ? {} : { preparedInputs }),
      fixtureScenario: scenario,
    },
    context.signal,
  );
  const run =
    started.status === 'running'
      ? await context.autoHub.getRun(
          { runRef: started.runRef, fixtureScenario: scenario },
          context.signal,
        )
      : started;

  if (run.status === 'unknown') {
    throw new SafeExecutionError({
      family: 'reconciliation-required',
      code: 'ZX_EXTERNAL_RUN_UNKNOWN',
      message: 'external run state is uncertain',
      retryable: false,
      details: { runRef: run.runRef },
      traceId: context.request.traceId,
    });
  }
  if (run.status === 'cancelled') {
    throw new SafeExecutionError({
      family: 'cancelled',
      code: 'ZX_PROVIDER_CANCELLED',
      message: 'provider run was cancelled',
      retryable: false,
      traceId: context.request.traceId,
    });
  }
  if (run.status === 'failed') {
    throw new SafeExecutionError({
      family: 'provider-rejected',
      code: run.safeErrorCode ?? 'ZX_PROVIDER_FAILED',
      message: 'provider run failed safely',
      retryable: false,
      traceId: context.request.traceId,
    });
  }
  const safeOutputRef = run.safeOutputRef;
  if (run.status !== 'succeeded' || !safeOutputRef) {
    throw new SafeExecutionError({
      family: 'malformed-output',
      code: 'ZX_PROVIDER_OUTPUT_MISSING',
      message: 'provider output reference is missing',
      retryable: true,
      traceId: context.request.traceId,
    });
  }
  return { ...run, safeOutputRef };
}

async function directOwnerAuthorizedHandoff(
  context: AdapterContext,
  kind: 'image' | 'video',
  preparedInputs: readonly PreparedExecutionInputV1[] = [],
): Promise<AdapterOutput> {
  const ownerStorageAccess = context.request.ownerStorageAccess;
  if (!ownerStorageAccess) {
    throw new SafeExecutionError({
      family: 'invalid-owner-request',
      code: 'ZX_OWNER_STORAGE_ACCESS_REQUIRED',
      message: 'owner-issued storage access is required for real generated media',
      retryable: false,
      traceId: context.request.traceId,
    });
  }
  if (ownerStorageAccess.artifactKind !== kind) {
    throw new SafeExecutionError({
      family: 'invalid-owner-request',
      code: 'ZX_OWNER_STORAGE_ARTIFACT_KIND_MISMATCH',
      message: 'owner-issued storage access does not match the generated artifact kind',
      retryable: false,
      traceId: context.request.traceId,
    });
  }
  if (!ownerStorageAccess.acceptedMimeTypes.includes(context.request.requestedOutputType)) {
    throw new SafeExecutionError({
      family: 'invalid-owner-request',
      code: 'ZX_OWNER_STORAGE_MIME_MISMATCH',
      message: 'owner-issued storage access does not accept the requested output MIME',
      retryable: false,
      traceId: context.request.traceId,
    });
  }

  const writeAuthorizationRef = delegatedOutputWriteAuthority(context.request);
  const temporaryArtifacts = context.temporaryArtifacts;
  if (!temporaryArtifacts) {
    throw new SafeExecutionError({
      family: 'adapter-unavailable',
      code: 'ZX_TEMP_ARTIFACT_RUNTIME_REQUIRED',
      message: 'temporary artifact recovery is required for delegated durable output handoff',
      retryable: true,
      traceId: context.request.traceId,
    });
  }
  if (context.storage.writeDelegatedOutput === undefined) {
    throw new SafeExecutionError({
      family: 'adapter-unavailable',
      code: 'ZX_Z_S_DELEGATED_OUTPUT_WRITER_UNAVAILABLE',
      message: 'the governed Z-s delegated output writer is unavailable',
      retryable: true,
      traceId: context.request.traceId,
    });
  }

  const run = await runProvider(context, undefined, preparedInputs);
  await context.recordProviderOutput({ externalRunRef: run.runRef });

  const scope = {
    ownerApp: context.request.ownerApp,
    ...(context.request.ownerProjectId === undefined
      ? {}
      : { ownerProjectId: context.request.ownerProjectId }),
    executionId: context.executionId,
    attemptId: context.attemptId,
  };
  const captured = await temporaryArtifacts.capture(
    {
      ...scope,
      safeSourceRef: run.safeOutputRef,
      expectedMimeType: context.request.requestedOutputType,
      ...(ownerStorageAccess.maxBytes === undefined ? {} : { maxBytes: ownerStorageAccess.maxBytes }),
    },
    context.signal,
  );
  await context.recordProviderOutput({ safeProviderOutputRef: captured.artifactRef });

  const artifact = await temporaryArtifacts.open(
    { ...scope, artifactRef: captured.artifactRef },
    context.signal,
  );
  const intent = await context.storage.createDelegatedOutputWriteIntent(
    {
      executionId: context.executionId,
      attemptId: context.attemptId,
      writeAuthorizationRef,
      artifact: {
        artifactRef: artifact.artifactRef,
        mimeType: artifact.mimeType,
        sizeBytes: artifact.sizeBytes,
        checksumSha256: artifact.checksumSha256,
      },
    },
    context.signal,
  );
  await context.recordOutputAuthorization(intent.writeIntentId);

  const stored = await context.storage.writeDelegatedOutput(
    {
      executionId: context.executionId,
      attemptId: context.attemptId,
      writeIntentId: intent.writeIntentId,
      writeAuthorityRef: intent.uploadCompletionToken,
      artifact,
    },
    context.signal,
  );
  const media = ownerCorrelatedDelegatedStorageResult(context.request, stored, kind);
  return {
    media,
    externalRunRef: run.runRef,
    safeProviderOutputRef: captured.artifactRef,
  };
}

export async function dispatchAndStoreMedia(
  context: AdapterContext,
  kind: 'image' | 'video',
  preparedInputs: readonly PreparedExecutionInputV1[] = [],
): Promise<AdapterOutput> {
  const scenario = fixtureScenario(context.request);
  if (scenario === undefined) {
    return directOwnerAuthorizedHandoff(context, kind, preparedInputs);
  }

  const storageOutput = context.request.storageOutput;
  const mode = storageOutput?.mode ?? 'post-run-ingest';
  if (mode === 'direct-write') {
    throw new SafeExecutionError({
      family: 'adapter-unavailable',
      code: 'ZX_DIRECT_WRITE_UNSUPPORTED',
      message: 'fixture direct-write storage output is not supported by this adapter path',
      retryable: false,
      traceId: context.request.traceId,
    });
  }
  const run = await runProvider(context, scenario);
  const mimeType = context.request.requestedOutputType;
  await context.recordProviderOutput({
    externalRunRef: run.runRef,
    safeProviderOutputRef: run.safeOutputRef,
  });
  const authorization = await context.storage.createOutputAuthorization(
    {
      executionId: context.executionId,
      attemptId: context.attemptId,
      mode,
      artifactKind: storageOutput?.artifactKind ?? kind,
      acceptedMimeTypes: storageOutput?.acceptedMimeTypes ?? [mimeType],
      storageProfileRef: storageOutput?.storageProfileRef,
      maxBytes: storageOutput?.maxBytes,
      mimeType,
      fixtureScenario: scenario,
    },
    context.signal,
  );
  await context.recordOutputAuthorization(authorization.authorizationRef);
  const media = await context.storage.completeOrIngestOutput(
    {
      executionId: context.executionId,
      attemptId: context.attemptId,
      authorizationRef: authorization.authorizationRef,
      safeProviderOutputRef: run.safeOutputRef,
      mimeType,
      fixtureScenario: scenario,
    },
    context.signal,
  );

  if (media.width === undefined || media.height === undefined) {
    throw new SafeExecutionError({
      family: 'malformed-output',
      code: 'ZX_MEDIA_DIMENSIONS_MISSING',
      message: 'stored media dimensions are missing',
      retryable: true,
      traceId: context.request.traceId,
    });
  }
  validateGeneratedMedia(kind, {
    ...media,
    width: media.width,
    height: media.height,
    durationSeconds: media.durationSeconds,
  });

  return {
    media,
    externalRunRef: run.runRef,
    safeProviderOutputRef: run.safeOutputRef,
  };
}
