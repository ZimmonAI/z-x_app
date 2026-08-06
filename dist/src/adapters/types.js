import { SafeExecutionError } from '../contracts/v1/error.js';
import { validateGeneratedMedia } from '../validation/output.js';
const FIXTURE_SCENARIOS = new Set([
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
export function fixtureScenario(request) {
    const value = request.safeScalarInputs.fixtureScenario;
    return typeof value === 'string' && FIXTURE_SCENARIOS.has(value)
        ? value
        : undefined;
}
export function requiredScalarString(request, key) {
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
export async function dispatchAndStoreMedia(context, kind) {
    const scenario = fixtureScenario(context.request);
    const ownerStorageAccess = context.request.ownerStorageAccess;
    // Fixture compatibility is explicit. Every non-fixture generated-media request
    // must carry owner-issued access, and the reference is persisted before any
    // provider action. The delegated Z-s transport is not owner-published yet, so
    // real execution stops truthfully at this exact pre-dispatch boundary.
    if (scenario === undefined) {
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
        await context.recordOutputAuthorization(ownerStorageAccess.outputWriteGrantRef);
        throw new SafeExecutionError({
            family: 'adapter-unavailable',
            code: 'ZX_Z_S_DELEGATED_OUTPUT_NOT_READY',
            message: 'the delegated owner-issued Z-s output transport is not ready',
            retryable: true,
            traceId: context.request.traceId,
        });
    }
    const storageOutput = context.request.storageOutput;
    const mode = storageOutput?.mode ?? 'post-run-ingest';
    if (mode === 'direct-write') {
        throw new SafeExecutionError({
            family: 'adapter-unavailable',
            code: 'ZX_DIRECT_WRITE_UNSUPPORTED',
            message: 'direct-write storage output is not supported by this adapter path',
            retryable: false,
            traceId: context.request.traceId,
        });
    }
    const started = await context.autoHub.startRun({
        operation: context.request.operationType,
        adapterId: context.route.adapterId,
        runtimeBindingRef: context.capacity.runtimeBindingRef,
        fixtureScenario: scenario,
    }, context.signal);
    const run = started.status === 'running'
        ? await context.autoHub.getRun({ runRef: started.runRef, fixtureScenario: scenario }, context.signal)
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
    if (run.status !== 'succeeded' || !run.safeOutputRef) {
        throw new SafeExecutionError({
            family: 'malformed-output',
            code: 'ZX_PROVIDER_OUTPUT_MISSING',
            message: 'provider output reference is missing',
            retryable: true,
            traceId: context.request.traceId,
        });
    }
    const mimeType = context.request.requestedOutputType;
    await context.recordProviderOutput({
        externalRunRef: run.runRef,
        safeProviderOutputRef: run.safeOutputRef,
    });
    const authorization = await context.storage.createOutputAuthorization({
        executionId: context.executionId,
        attemptId: context.attemptId,
        mode,
        artifactKind: storageOutput?.artifactKind ?? kind,
        acceptedMimeTypes: storageOutput?.acceptedMimeTypes ?? [mimeType],
        storageProfileRef: storageOutput?.storageProfileRef,
        maxBytes: storageOutput?.maxBytes,
        mimeType,
        fixtureScenario: scenario,
    }, context.signal);
    await context.recordOutputAuthorization(authorization.authorizationRef);
    const media = await context.storage.completeOrIngestOutput({
        executionId: context.executionId,
        attemptId: context.attemptId,
        authorizationRef: authorization.authorizationRef,
        safeProviderOutputRef: run.safeOutputRef,
        mimeType,
        fixtureScenario: scenario,
    }, context.signal);
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
//# sourceMappingURL=types.js.map