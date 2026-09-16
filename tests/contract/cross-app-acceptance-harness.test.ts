import { describe, expect, it } from 'vitest';
import {
  buildGenericExecutionSubmit,
  createNeutralOwnerFixture,
  findForbiddenLeaks,
  runAcceptedSubmitPersistenceFailurePreparation,
  runNeutralOwnerAcceptancePreparation,
  runStorageOnlyRecoveryPreparation,
  type AcceptanceSourceSet,
  type CrossAppAcceptanceDriver,
  type GenericExecutionSubmit,
} from '../acceptance/cross-app-harness.js';

const sources: AcceptanceSourceSet = {
  owner: {
    repository: 'fixture://neutral-owner',
    branch: 'fixture',
    sha: 'neutral-owner-fixture-v1',
  },
  zx: {
    repository: 'https://github.com/ZimmonAI/z-x_app',
    branch: 'main',
    sha: '2e9dd7e67dd8fdc87daf1201d7e1b237c9d1cc53',
  },
  zs: {
    repository: 'fixture://z-s-contract',
    branch: 'fixture',
    sha: 'z-s-contract-fixture-v1',
  },
};

class FakeCrossAppDriver implements CrossAppAcceptanceDriver {
  lastRequest: Readonly<GenericExecutionSubmit> | undefined;
  changedFingerprintProbe: string | undefined;

  constructor(
    private readonly overrides: Readonly<{
      inputStorageObjectId?: string;
      outputStorageServiceId?: string;
      outputWriteIntentId?: string;
      publicResult?: unknown;
      recoveryProductionAttemptCount?: number;
      retryExecutionId?: string;
    }> = {},
  ) {}

  async submitExecution(
    request: Readonly<GenericExecutionSubmit>,
  ): Promise<Readonly<{ executionId: string; state: string }>> {
    this.lastRequest = request;
    return { executionId: 'zx-execution-neutral-0001', state: 'accepted' };
  }

  async readExecution(executionId: string) {
    return {
      executionId,
      ownerApp: 'neutral-test-owner',
      ownerActionId: 'cross-app-acceptance-action-v1',
      state: 'succeeded',
      result: this.overrides.publicResult ?? {
        storageObjectId: 'zs-object-neutral-output-0001',
        state: 'ready',
      },
    };
  }

  async observeExactInput(_executionId: string) {
    return {
      storageObjectId:
        this.overrides.inputStorageObjectId ?? 'zs-object-neutral-input-0001',
      checksumSha256: 'a'.repeat(64),
    };
  }

  async observeDurableOutput(_executionId: string) {
    return {
      storageObjectId: 'zs-object-neutral-output-0001',
      writeIntentId:
        this.overrides.outputWriteIntentId ?? 'zs-write-intent-neutral-0001',
      storageServiceId:
        this.overrides.outputStorageServiceId ?? 'zs-storage-service-neutral-a',
      checksumSha256: 'b'.repeat(64),
    };
  }

  async exerciseStorageOnlyRecovery(request: Readonly<GenericExecutionSubmit>) {
    return {
      executionId: 'zx-execution-recovery-0001',
      ownerActionId: request.ownerActionId,
      requestFingerprint: request.requestFingerprint,
      artifactSafeFingerprint: 'c'.repeat(64),
      firstHandoffFailureCode: 'ZX_Z_S_DELEGATED_WRITE_RETRYABLE_FAILURE',
      productionAttemptCount: this.overrides.recoveryProductionAttemptCount ?? 1,
      durableHandoffAttemptCount: 2,
      finalStorageObjectId: 'zs-object-neutral-output-recovery-0001',
      finalState: 'succeeded' as const,
      recoveryScope: 'same-runtime' as const,
    };
  }

  async exerciseAcceptedSubmitPersistFailure(request: Readonly<GenericExecutionSubmit>) {
    return {
      ownerActionId: request.ownerActionId,
      requestFingerprint: request.requestFingerprint,
      idempotencyKey: request.idempotencyKey,
      firstExecutionId: 'zx-execution-idempotent-0001',
      retryExecutionId: this.overrides.retryExecutionId ?? 'zx-execution-idempotent-0001',
      productionAttemptCount: 1,
    };
  }

  async probeChangedFingerprintConflict(
    request: Readonly<GenericExecutionSubmit>,
    changedRequestFingerprint: string,
  ): Promise<'rejected'> {
    expect(changedRequestFingerprint).not.toBe(request.requestFingerprint);
    this.changedFingerprintProbe = changedRequestFingerprint;
    return 'rejected';
  }
}

describe('03-06 Phase A cross-app acceptance preparation', () => {
  it('keeps the neutral owner fixture free of Video Maker business assumptions', () => {
    const fixture = createNeutralOwnerFixture();
    const serialized = JSON.stringify(fixture).toLowerCase();

    expect(fixture.ownerApp).toBe('neutral-test-owner');
    expect(serialized).not.toMatch(/video[-_ ]?maker/);
    expect(serialized).not.toContain('scene');
    expect(serialized).not.toContain('series');
    expect(serialized).not.toContain('resource');
  });

  it('drives one generic neutral-owner case and captures safe exact input/output evidence', async () => {
    const fixture = createNeutralOwnerFixture();
    const driver = new FakeCrossAppDriver();

    const evidence = await runNeutralOwnerAcceptancePreparation(
      driver,
      fixture,
      sources,
      {
        acceptanceCaseId: '03-06-A1-A5-A9-neutral-owner-harness',
        now: () => new Date('2026-09-16T06:00:00.000Z'),
      },
    );

    expect(driver.lastRequest).toEqual(buildGenericExecutionSubmit(fixture));
    expect(JSON.stringify(driver.lastRequest)).toContain(fixture.input.storageObjectId);
    expect(JSON.stringify(driver.lastRequest)).toContain(fixture.output.writeIntentId);
    expect(JSON.stringify(driver.lastRequest)).not.toContain(
      fixture.output.selectedStorageServiceId,
    );
    expect(driver.lastRequest?.delegatedAuthorities.map((item) => item.name)).toEqual([
      'input.primary.read',
      'output.primary.write',
    ]);

    expect(evidence).toMatchObject({
      ownerApp: fixture.ownerApp,
      ownerActionId: fixture.ownerActionId,
      inputStorageObjectId: fixture.input.storageObjectId,
      selectedOutputStorageServiceId: fixture.output.selectedStorageServiceId,
      zxExecutionId: 'zx-execution-neutral-0001',
      result: 'PASS',
    });
    expect(JSON.stringify(evidence)).not.toContain(fixture.input.readAuthorityRef);
    expect(JSON.stringify(evidence)).not.toContain(fixture.output.writeAuthorityRef);
  });

  it('A6/A7 require one production and a storage-only retry from the same safe artifact identity', async () => {
    const fixture = createNeutralOwnerFixture();
    const evidence = await runStorageOnlyRecoveryPreparation(
      new FakeCrossAppDriver(),
      fixture,
      sources,
      {
        now: () => new Date('2026-09-16T06:10:00.000Z'),
      },
    );

    expect(evidence).toMatchObject({
      productionAttemptCount: 1,
      durableHandoffAttemptCount: 2,
      firstHandoffFailureCode: 'ZX_Z_S_DELEGATED_WRITE_RETRYABLE_FAILURE',
      recoveryScope: 'same-runtime',
      result: 'PASS',
    });
    expect(evidence.artifactSafeFingerprint).toBe('c'.repeat(64));
    expect(JSON.stringify(evidence)).not.toMatch(/providerPath|bucket|objectKey|signedUrl/i);
  });

  it('A6/A7 fail if the recovery path repeats provider/materialization production', async () => {
    const fixture = createNeutralOwnerFixture();
    await expect(
      runStorageOnlyRecoveryPreparation(
        new FakeCrossAppDriver({ recoveryProductionAttemptCount: 2 }),
        fixture,
        sources,
      ),
    ).rejects.toThrow(/repeated provider\/materialization production/);
  });

  it('A8 reconciles the same accepted execution and rejects a changed frozen fingerprint', async () => {
    const fixture = createNeutralOwnerFixture();
    const driver = new FakeCrossAppDriver();
    const evidence = await runAcceptedSubmitPersistenceFailurePreparation(
      driver,
      fixture,
      sources,
      {
        now: () => new Date('2026-09-16T06:20:00.000Z'),
      },
    );

    expect(evidence).toMatchObject({
      ownerActionId: fixture.ownerActionId,
      requestFingerprint: fixture.requestFingerprint,
      idempotencyKey: fixture.idempotencyKey,
      zxExecutionId: 'zx-execution-idempotent-0001',
      productionAttemptCount: 1,
      changedFingerprintConflict: 'rejected',
      result: 'PASS',
    });
    expect(driver.changedFingerprintProbe).toMatch(/^[a-f0-9]{64}$/);
    expect(driver.changedFingerprintProbe).not.toBe(fixture.requestFingerprint);
  });

  it('A8 fails if retry creates a second accepted execution', async () => {
    const fixture = createNeutralOwnerFixture();
    await expect(
      runAcceptedSubmitPersistenceFailurePreparation(
        new FakeCrossAppDriver({ retryExecutionId: 'zx-execution-duplicate-0002' }),
        fixture,
        sources,
      ),
    ).rejects.toThrow(/duplicate Z-X execution/);
  });

  it('rejects output target substitution instead of silently correcting it', async () => {
    const fixture = createNeutralOwnerFixture();
    const driver = new FakeCrossAppDriver({
      outputStorageServiceId: 'zs-storage-service-substituted-b',
    });

    await expect(
      runNeutralOwnerAcceptancePreparation(driver, fixture, sources),
    ).rejects.toThrow(/output Storage Service substituted/);
  });

  it('rejects sibling or derivative input substitution', async () => {
    const fixture = createNeutralOwnerFixture();
    const driver = new FakeCrossAppDriver({
      inputStorageObjectId: 'zs-object-neutral-input-sibling-0002',
    });

    await expect(
      runNeutralOwnerAcceptancePreparation(driver, fixture, sources),
    ).rejects.toThrow(/exact input substituted/);
  });

  it('detects forbidden credential/private-storage leakage in public evidence', async () => {
    const fixture = createNeutralOwnerFixture();
    const ownerBearer = 'owner-long-lived-secret-value';
    const driver = new FakeCrossAppDriver({
      publicResult: {
        providerEndpoint: 'https://provider-private.example.test',
        nested: { accidental: ownerBearer },
      },
    });

    await expect(
      runNeutralOwnerAcceptancePreparation(driver, fixture, sources, {
        forbiddenSecretValues: [ownerBearer],
      }),
    ).rejects.toThrow(/forbidden acceptance evidence leakage/);

    expect(
      findForbiddenLeaks(
        {
          safe: {
            ownerApp: fixture.ownerApp,
            storageObjectId: fixture.input.storageObjectId,
            storageServiceId: fixture.output.selectedStorageServiceId,
          },
        },
        [ownerBearer],
      ),
    ).toEqual([]);
  });
});
