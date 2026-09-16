import { createHash } from 'node:crypto';

export const NEUTRAL_OWNER_APP = 'neutral-test-owner' as const;
export const NEUTRAL_OWNER_ACTION = 'cross-app-acceptance-action-v1' as const;
export const NEUTRAL_EXECUTION_METHOD = 'neutral.binary-transform.v1' as const;

export interface NeutralOwnerFixture {
  readonly ownerApp: typeof NEUTRAL_OWNER_APP;
  readonly ownerActionId: typeof NEUTRAL_OWNER_ACTION;
  readonly executionMethodId: typeof NEUTRAL_EXECUTION_METHOD;
  readonly idempotencyKey: string;
  readonly requestFingerprint: string;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly input: Readonly<{
    storageObjectId: string;
    readAuthorityRef: string;
  }>;
  readonly output: Readonly<{
    selectedStorageServiceId: string;
    writeIntentId: string;
    writeAuthorityRef: string;
  }>;
}

export interface GenericExecutionSubmit {
  readonly ownerApp: string;
  readonly ownerActionId: string;
  readonly executionMethodId: string;
  readonly idempotencyKey: string;
  readonly requestFingerprint: string;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly delegatedAuthorities: ReadonlyArray<
    Readonly<{
      name: string;
      reference: string;
    }>
  >;
}

export interface NormalizedExecutionSnapshot {
  readonly executionId: string;
  readonly ownerApp: string;
  readonly ownerActionId: string;
  readonly state: string;
  readonly result?: unknown;
}

export interface ExactInputObservation {
  readonly storageObjectId: string;
  readonly checksumSha256: string;
}

export interface DurableOutputObservation {
  readonly storageObjectId: string;
  readonly writeIntentId: string;
  readonly storageServiceId: string;
  readonly checksumSha256: string;
}

export interface StorageRecoveryObservation {
  readonly executionId: string;
  readonly ownerActionId: string;
  readonly requestFingerprint: string;
  readonly artifactSafeFingerprint: string;
  readonly firstHandoffFailureCode: string;
  readonly productionAttemptCount: number;
  readonly durableHandoffAttemptCount: number;
  readonly finalStorageObjectId: string;
  readonly finalState: 'succeeded';
  readonly recoveryScope: 'same-runtime' | 'restart-safe';
}

export interface AcceptedSubmitPersistenceFailureObservation {
  readonly ownerActionId: string;
  readonly requestFingerprint: string;
  readonly idempotencyKey: string;
  readonly firstExecutionId: string;
  readonly retryExecutionId: string;
  readonly productionAttemptCount: number;
}

export interface CrossAppAcceptanceDriver {
  submitExecution(
    request: Readonly<GenericExecutionSubmit>,
  ): Promise<Readonly<{ executionId: string; state: string }>>;
  readExecution(executionId: string): Promise<Readonly<NormalizedExecutionSnapshot>>;
  cancelExecution?(executionId: string): Promise<void>;
  observeExactInput(executionId: string): Promise<Readonly<ExactInputObservation>>;
  observeDurableOutput(executionId: string): Promise<Readonly<DurableOutputObservation>>;
  exerciseStorageOnlyRecovery?(
    request: Readonly<GenericExecutionSubmit>,
  ): Promise<Readonly<StorageRecoveryObservation>>;
  exerciseAcceptedSubmitPersistFailure?(
    request: Readonly<GenericExecutionSubmit>,
  ): Promise<Readonly<AcceptedSubmitPersistenceFailureObservation>>;
  probeChangedFingerprintConflict?(
    request: Readonly<GenericExecutionSubmit>,
    changedRequestFingerprint: string,
  ): Promise<'rejected'>;
}

export interface AcceptanceSourceIdentity {
  readonly repository: string;
  readonly branch: string;
  readonly sha: string;
}

export interface AcceptanceSourceSet {
  readonly owner: AcceptanceSourceIdentity;
  readonly zx: AcceptanceSourceIdentity;
  readonly zs: AcceptanceSourceIdentity;
}

export interface AcceptanceEvidenceRecord {
  readonly acceptanceCaseId: string;
  readonly timestamp: string;
  readonly ownerSource: AcceptanceSourceIdentity;
  readonly zxSource: AcceptanceSourceIdentity;
  readonly zsSource: AcceptanceSourceIdentity;
  readonly ownerApp: string;
  readonly ownerActionId: string;
  readonly executionMethodId: string;
  readonly inputStorageObjectId: string;
  readonly selectedOutputStorageServiceId: string;
  readonly zxExecutionId: string;
  readonly finalStorageObjectId: string;
  readonly resultState: string;
  readonly redactionSecurityResult: 'PASS';
  readonly result: 'PASS';
}

export interface StorageRecoveryEvidenceRecord {
  readonly acceptanceCaseId: string;
  readonly timestamp: string;
  readonly ownerSource: AcceptanceSourceIdentity;
  readonly zxSource: AcceptanceSourceIdentity;
  readonly zsSource: AcceptanceSourceIdentity;
  readonly ownerApp: string;
  readonly ownerActionId: string;
  readonly requestFingerprint: string;
  readonly zxExecutionId: string;
  readonly artifactSafeFingerprint: string;
  readonly firstHandoffFailureCode: string;
  readonly productionAttemptCount: 1;
  readonly durableHandoffAttemptCount: number;
  readonly finalStorageObjectId: string;
  readonly recoveryScope: 'same-runtime' | 'restart-safe';
  readonly result: 'PASS';
}

export interface IdempotencyEvidenceRecord {
  readonly acceptanceCaseId: string;
  readonly timestamp: string;
  readonly ownerSource: AcceptanceSourceIdentity;
  readonly zxSource: AcceptanceSourceIdentity;
  readonly ownerApp: string;
  readonly ownerActionId: string;
  readonly requestFingerprint: string;
  readonly idempotencyKey: string;
  readonly zxExecutionId: string;
  readonly productionAttemptCount: 1;
  readonly changedFingerprintConflict: 'rejected';
  readonly result: 'PASS';
}

const FORBIDDEN_KEY_FRAGMENTS = [
  'authorization',
  'ownerbearer',
  'longlivedbearer',
  'zxservicecredential',
  'providercredential',
  'providerendpoint',
  'bucket',
  'objectkey',
  'privatelocator',
  'signedproviderurl',
  'accesskey',
  'secretkey',
] as const;

const FORBIDDEN_VALUE_PATTERNS = [
  /\bbearer\s+[a-z0-9._~+/-]+=*/i,
  /\bs3:\/\//i,
  /\br2:\/\//i,
  /[?&]x-amz-signature=/i,
  /[?&]x-goog-signature=/i,
] as const;

function normalizeKey(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function stableFingerprint(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function changedFingerprint(original: string): string {
  return createHash('sha256').update(original).update('\0changed').digest('hex');
}

export function createNeutralOwnerFixture(): Readonly<NeutralOwnerFixture> {
  const payload = Object.freeze({
    operation: 'copy-through',
    message: 'neutral owner cross-app acceptance fixture',
  });
  const frozenSelection = {
    ownerApp: NEUTRAL_OWNER_APP,
    ownerActionId: NEUTRAL_OWNER_ACTION,
    executionMethodId: NEUTRAL_EXECUTION_METHOD,
    payload,
    inputStorageObjectId: 'zs-object-neutral-input-0001',
    outputWriteIntentId: 'zs-write-intent-neutral-0001',
    selectedOutputStorageServiceId: 'zs-storage-service-neutral-a',
  };

  return Object.freeze({
    ownerApp: NEUTRAL_OWNER_APP,
    ownerActionId: NEUTRAL_OWNER_ACTION,
    executionMethodId: NEUTRAL_EXECUTION_METHOD,
    idempotencyKey: 'neutral-owner-acceptance-idempotency-v1',
    requestFingerprint: stableFingerprint(frozenSelection),
    payload,
    input: Object.freeze({
      storageObjectId: frozenSelection.inputStorageObjectId,
      readAuthorityRef: 'zsauth_read_neutral_0001',
    }),
    output: Object.freeze({
      selectedStorageServiceId: frozenSelection.selectedOutputStorageServiceId,
      writeIntentId: frozenSelection.outputWriteIntentId,
      writeAuthorityRef: 'zsauth_write_neutral_0001',
    }),
  });
}

export function buildGenericExecutionSubmit(
  fixture: Readonly<NeutralOwnerFixture>,
): Readonly<GenericExecutionSubmit> {
  return Object.freeze({
    ownerApp: fixture.ownerApp,
    ownerActionId: fixture.ownerActionId,
    executionMethodId: fixture.executionMethodId,
    idempotencyKey: fixture.idempotencyKey,
    requestFingerprint: fixture.requestFingerprint,
    payload: Object.freeze({
      ...fixture.payload,
      inputStorageObjectId: fixture.input.storageObjectId,
      outputWriteIntentId: fixture.output.writeIntentId,
    }),
    delegatedAuthorities: Object.freeze([
      Object.freeze({
        name: 'input.primary.read',
        reference: fixture.input.readAuthorityRef,
      }),
      Object.freeze({
        name: 'output.primary.write',
        reference: fixture.output.writeAuthorityRef,
      }),
    ]),
  });
}

export function findForbiddenLeaks(
  value: unknown,
  secretValues: readonly string[] = [],
): string[] {
  const findings: string[] = [];
  const visited = new WeakSet<object>();

  function inspect(current: unknown, path: string): void {
    if (typeof current === 'string') {
      for (const secret of secretValues) {
        if (secret.length > 0 && current.includes(secret)) {
          findings.push(`${path}: contains configured secret value`);
        }
      }
      for (const pattern of FORBIDDEN_VALUE_PATTERNS) {
        if (pattern.test(current)) {
          findings.push(`${path}: contains provider/private credential material`);
          break;
        }
      }
      return;
    }

    if (current === null || typeof current !== 'object') return;
    if (visited.has(current)) return;
    visited.add(current);

    if (Array.isArray(current)) {
      current.forEach((item, index) => inspect(item, `${path}[${index}]`));
      return;
    }

    for (const [key, nested] of Object.entries(current)) {
      const normalized = normalizeKey(key);
      if (FORBIDDEN_KEY_FRAGMENTS.some((fragment) => normalized.includes(fragment))) {
        findings.push(`${path}.${key}: forbidden private/credential field`);
      }
      inspect(nested, `${path}.${key}`);
    }
  }

  inspect(value, '$');
  return findings;
}

export function assertNoForbiddenLeaks(
  value: unknown,
  secretValues: readonly string[] = [],
): void {
  const findings = findForbiddenLeaks(value, secretValues);
  if (findings.length > 0) {
    throw new Error(`forbidden acceptance evidence leakage: ${findings.join('; ')}`);
  }
}

export function assertExactInputSelection(
  fixture: Readonly<NeutralOwnerFixture>,
  observation: Readonly<ExactInputObservation>,
): void {
  if (observation.storageObjectId !== fixture.input.storageObjectId) {
    throw new Error(
      `exact input substituted: expected ${fixture.input.storageObjectId}, got ${observation.storageObjectId}`,
    );
  }
}

export function assertExactOutputTarget(
  fixture: Readonly<NeutralOwnerFixture>,
  observation: Readonly<DurableOutputObservation>,
): void {
  if (observation.writeIntentId !== fixture.output.writeIntentId) {
    throw new Error(
      `output write intent substituted: expected ${fixture.output.writeIntentId}, got ${observation.writeIntentId}`,
    );
  }
  if (observation.storageServiceId !== fixture.output.selectedStorageServiceId) {
    throw new Error(
      `output Storage Service substituted: expected ${fixture.output.selectedStorageServiceId}, got ${observation.storageServiceId}`,
    );
  }
}

export function assertStorageOnlyRecovery(
  fixture: Readonly<NeutralOwnerFixture>,
  observation: Readonly<StorageRecoveryObservation>,
): void {
  if (
    observation.ownerActionId !== fixture.ownerActionId
    || observation.requestFingerprint !== fixture.requestFingerprint
  ) {
    throw new Error('storage recovery changed owner/action correlation');
  }
  if (!/^[a-f0-9]{64}$/.test(observation.artifactSafeFingerprint)) {
    throw new Error('storage recovery artifact safe fingerprint is invalid');
  }
  if (observation.firstHandoffFailureCode !== 'ZX_Z_S_DELEGATED_WRITE_RETRYABLE_FAILURE') {
    throw new Error('storage recovery did not begin from the controlled retryable Z-s handoff failure');
  }
  if (observation.productionAttemptCount !== 1) {
    throw new Error('storage recovery repeated provider/materialization production');
  }
  if (observation.durableHandoffAttemptCount < 2) {
    throw new Error('storage recovery did not retry the durable handoff');
  }
  if (observation.finalState !== 'succeeded') {
    throw new Error('storage recovery did not reach durable success');
  }
}

export function assertAcceptedSubmitPersistenceRecovery(
  fixture: Readonly<NeutralOwnerFixture>,
  observation: Readonly<AcceptedSubmitPersistenceFailureObservation>,
): void {
  if (
    observation.ownerActionId !== fixture.ownerActionId
    || observation.requestFingerprint !== fixture.requestFingerprint
    || observation.idempotencyKey !== fixture.idempotencyKey
  ) {
    throw new Error('accepted-submit recovery changed frozen owner identity');
  }
  if (observation.firstExecutionId !== observation.retryExecutionId) {
    throw new Error('accepted-submit recovery created a duplicate Z-X execution');
  }
  if (observation.productionAttemptCount !== 1) {
    throw new Error('accepted-submit recovery duplicated provider production');
  }
}

export async function runNeutralOwnerAcceptancePreparation(
  driver: CrossAppAcceptanceDriver,
  fixture: Readonly<NeutralOwnerFixture>,
  sources: Readonly<AcceptanceSourceSet>,
  options: Readonly<{
    acceptanceCaseId?: string;
    now?: () => Date;
    forbiddenSecretValues?: readonly string[];
  }> = {},
): Promise<Readonly<AcceptanceEvidenceRecord>> {
  const request = buildGenericExecutionSubmit(fixture);
  assertNoForbiddenLeaks(request, options.forbiddenSecretValues);

  const submitted = await driver.submitExecution(request);
  const snapshot = await driver.readExecution(submitted.executionId);

  if (snapshot.executionId !== submitted.executionId) {
    throw new Error('execution read returned a different execution identity');
  }
  if (snapshot.ownerApp !== fixture.ownerApp || snapshot.ownerActionId !== fixture.ownerActionId) {
    throw new Error('execution owner correlation changed');
  }
  assertNoForbiddenLeaks(snapshot, options.forbiddenSecretValues);

  const inputObservation = await driver.observeExactInput(submitted.executionId);
  assertExactInputSelection(fixture, inputObservation);
  assertNoForbiddenLeaks(inputObservation, options.forbiddenSecretValues);

  const outputObservation = await driver.observeDurableOutput(submitted.executionId);
  assertExactOutputTarget(fixture, outputObservation);
  assertNoForbiddenLeaks(outputObservation, options.forbiddenSecretValues);

  return Object.freeze({
    acceptanceCaseId: options.acceptanceCaseId ?? '03-06-A-neutral-owner-preparation',
    timestamp: (options.now ?? (() => new Date()))().toISOString(),
    ownerSource: sources.owner,
    zxSource: sources.zx,
    zsSource: sources.zs,
    ownerApp: fixture.ownerApp,
    ownerActionId: fixture.ownerActionId,
    executionMethodId: fixture.executionMethodId,
    inputStorageObjectId: fixture.input.storageObjectId,
    selectedOutputStorageServiceId: fixture.output.selectedStorageServiceId,
    zxExecutionId: submitted.executionId,
    finalStorageObjectId: outputObservation.storageObjectId,
    resultState: snapshot.state,
    redactionSecurityResult: 'PASS',
    result: 'PASS',
  });
}

export async function runStorageOnlyRecoveryPreparation(
  driver: CrossAppAcceptanceDriver,
  fixture: Readonly<NeutralOwnerFixture>,
  sources: Readonly<AcceptanceSourceSet>,
  options: Readonly<{ acceptanceCaseId?: string; now?: () => Date }> = {},
): Promise<Readonly<StorageRecoveryEvidenceRecord>> {
  if (!driver.exerciseStorageOnlyRecovery) {
    throw new Error('acceptance driver does not expose the controlled storage-recovery probe');
  }
  const request = buildGenericExecutionSubmit(fixture);
  const observation = await driver.exerciseStorageOnlyRecovery(request);
  assertStorageOnlyRecovery(fixture, observation);
  assertNoForbiddenLeaks(observation);

  return Object.freeze({
    acceptanceCaseId: options.acceptanceCaseId ?? '03-06-A6-A7-storage-only-recovery',
    timestamp: (options.now ?? (() => new Date()))().toISOString(),
    ownerSource: sources.owner,
    zxSource: sources.zx,
    zsSource: sources.zs,
    ownerApp: fixture.ownerApp,
    ownerActionId: fixture.ownerActionId,
    requestFingerprint: fixture.requestFingerprint,
    zxExecutionId: observation.executionId,
    artifactSafeFingerprint: observation.artifactSafeFingerprint,
    firstHandoffFailureCode: observation.firstHandoffFailureCode,
    productionAttemptCount: 1,
    durableHandoffAttemptCount: observation.durableHandoffAttemptCount,
    finalStorageObjectId: observation.finalStorageObjectId,
    recoveryScope: observation.recoveryScope,
    result: 'PASS',
  });
}

export async function runAcceptedSubmitPersistenceFailurePreparation(
  driver: CrossAppAcceptanceDriver,
  fixture: Readonly<NeutralOwnerFixture>,
  sources: Readonly<AcceptanceSourceSet>,
  options: Readonly<{ acceptanceCaseId?: string; now?: () => Date }> = {},
): Promise<Readonly<IdempotencyEvidenceRecord>> {
  if (!driver.exerciseAcceptedSubmitPersistFailure || !driver.probeChangedFingerprintConflict) {
    throw new Error('acceptance driver does not expose the idempotency reconciliation probes');
  }
  const request = buildGenericExecutionSubmit(fixture);
  const observation = await driver.exerciseAcceptedSubmitPersistFailure(request);
  assertAcceptedSubmitPersistenceRecovery(fixture, observation);
  const conflict = await driver.probeChangedFingerprintConflict(
    request,
    changedFingerprint(fixture.requestFingerprint),
  );
  if (conflict !== 'rejected') {
    throw new Error('changed request fingerprint did not fail closed');
  }
  assertNoForbiddenLeaks(observation);

  return Object.freeze({
    acceptanceCaseId: options.acceptanceCaseId ?? '03-06-A8-accepted-submit-persist-failure',
    timestamp: (options.now ?? (() => new Date()))().toISOString(),
    ownerSource: sources.owner,
    zxSource: sources.zx,
    ownerApp: fixture.ownerApp,
    ownerActionId: fixture.ownerActionId,
    requestFingerprint: fixture.requestFingerprint,
    idempotencyKey: fixture.idempotencyKey,
    zxExecutionId: observation.retryExecutionId,
    productionAttemptCount: 1,
    changedFingerprintConflict: 'rejected',
    result: 'PASS',
  });
}
