import { ZStorageFixtureV1 } from '../../fixtures/v1/z-s.js';
import { dispatchAndStoreMedia } from '../../src/adapters/types.js';
import { SafeExecutionError } from '../../src/contracts/v1/error.js';
import { ExecutionRequestV1Schema } from '../../src/contracts/v1/execution.js';
import { validRequest } from '../unit/test-request.js';
const autoHub = {
    async startRun() {
        return { runRef: 'run-1', status: 'succeeded', safeOutputRef: 'safe-provider-output-1' };
    },
    async getRun() {
        return { runRef: 'run-1', status: 'succeeded', safeOutputRef: 'safe-provider-output-1' };
    },
    async cancelRun() {
        return { runRef: 'run-1', status: 'cancelled' };
    },
};
const route = {
    routeId: 'route-1',
    routeVersion: '1',
    operation: 'image.generate.v1',
    provider: 'fixture',
    model: 'fixture',
    tool: 'fixture',
    software: 'fixture',
    runMode: 'fixture',
    adapterId: 'image-generate-fixture',
    adapterVersion: '1.0.0',
    invocationMode: 'fixture',
    parameterSchemaDigest: 'digest',
    timeoutClass: 'default',
    resourceClass: 'default',
    authSessionMethodClass: 'fixture',
    resolvedAt: new Date(0).toISOString(),
};
const capacity = {
    leaseRef: 'lease-1',
    runtimeBindingRef: 'runtime-1',
    acquiredAt: new Date(0).toISOString(),
    expiresAt: new Date(60000).toISOString(),
    eligibilityOutcome: 'eligible',
    requirementDigest: 'digest',
};
function request(mode = 'post-run-ingest') {
    return ExecutionRequestV1Schema.parse({
        ...validRequest('image.generate.v1'),
        safeScalarInputs: { prompt: 'cinematic sunrise', fixtureScenario: 'success' },
        requestedOutputType: 'image/png',
        storageOutput: {
            contractVersion: 'zx.storage-output.v1',
            mode,
            artifactKind: 'image',
            acceptedMimeTypes: ['image/png'],
        },
    });
}
function context(input) {
    return {
        request: request(input.mode),
        route,
        capacity,
        executionId: 'execution-1',
        attemptId: input.attemptId,
        signal: new AbortController().signal,
        autoHub,
        storage: input.storage,
        async recordProviderOutput(record) {
            input.providerRefs.push(record.safeProviderOutputRef);
        },
        async recordOutputAuthorization(authorizationRef) {
            input.authorizationRefs.push(authorizationRef);
        },
    };
}
class AuthorizationFailureStorage extends ZStorageFixtureV1 {
    async createOutputAuthorization(_input, _signal) {
        throw new SafeExecutionError({
            family: 'storage-output-failure',
            code: 'ZX_AUTHORIZATION_FAILED',
            message: 'fixture authorization failure',
            retryable: true,
            traceId: 'fixture',
        });
    }
}
class CompletionFailureStorage extends ZStorageFixtureV1 {
    async completeOrIngestOutput(input, signal) {
        await super.completeOrIngestOutput({ ...input, fixtureScenario: 'storage-failure' }, signal);
        throw new Error('unreachable');
    }
}
test('storage completion failure preserves provider output and authorization references', async () => {
    const providerRefs = [];
    const authorizationRefs = [];
    await expect(dispatchAndStoreMedia(context({
        attemptId: 'attempt-1',
        storage: new CompletionFailureStorage(),
        providerRefs,
        authorizationRefs,
    }), 'image')).rejects.toThrow(/storage failure/);
    expect(providerRefs).toEqual(['safe-provider-output-1']);
    expect(authorizationRefs).toEqual(['outauth_execution-1_attempt-1']);
});
test('authorization failure preserves only provider output reference', async () => {
    const providerRefs = [];
    const authorizationRefs = [];
    await expect(dispatchAndStoreMedia(context({
        attemptId: 'attempt-1',
        storage: new AuthorizationFailureStorage(),
        providerRefs,
        authorizationRefs,
    }), 'image')).rejects.toThrow(/authorization failure/);
    expect(providerRefs).toEqual(['safe-provider-output-1']);
    expect(authorizationRefs).toEqual([]);
});
test('retry attempts use isolated authorization references', async () => {
    const providerRefs = [];
    const authorizationRefs = [];
    await dispatchAndStoreMedia(context({ attemptId: 'attempt-1', storage: new ZStorageFixtureV1(), providerRefs, authorizationRefs }), 'image');
    await dispatchAndStoreMedia(context({ attemptId: 'attempt-2', storage: new ZStorageFixtureV1(), providerRefs, authorizationRefs }), 'image');
    expect(authorizationRefs).toEqual([
        'outauth_execution-1_attempt-1',
        'outauth_execution-1_attempt-2',
    ]);
});
test('direct-write fails safely without fake storage success', async () => {
    const providerRefs = [];
    const authorizationRefs = [];
    await expect(dispatchAndStoreMedia(context({
        attemptId: 'attempt-1',
        storage: new ZStorageFixtureV1(),
        providerRefs,
        authorizationRefs,
        mode: 'direct-write',
    }), 'image')).rejects.toThrow(/direct-write/);
    expect(authorizationRefs).toEqual([]);
});
test('fixture read grant remains deterministic', async () => {
    const fixture = new ZStorageFixtureV1();
    const signal = new AbortController().signal;
    const grant = await fixture.createReadGrant({ resourceId: 'resource-1' }, signal);
    expect(grant.readGrantRef).toBe('read_resource-1');
});
//# sourceMappingURL=storage-output-reconciliation.test.js.map