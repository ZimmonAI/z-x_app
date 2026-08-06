const fixtureScenarios = new Set([
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
    'storage-reconciliation-pending',
    'storage-reconciliation-retryable-failure',
    'storage-reconciliation-terminal-failure',
    'callback-failure',
    'unknown-run',
]);
function record(value, label) {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        throw new Error(`${label} must be an object`);
    }
    return value;
}
function exactKeys(value, allowed, label) {
    const permitted = new Set(allowed);
    for (const key of Object.keys(value)) {
        if (!permitted.has(key))
            throw new Error(`${label} contains prohibited field ${key}`);
    }
}
function requiredString(value, label) {
    if (typeof value !== 'string' || value.length === 0)
        throw new Error(`${label} must be non-empty`);
    return value;
}
function optionalPositiveNumber(value, label) {
    if (value === undefined)
        return undefined;
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
        throw new Error(`${label} must be positive`);
    }
    return value;
}
function optionalPositiveInteger(value, label) {
    const parsed = optionalPositiveNumber(value, label);
    if (parsed !== undefined && !Number.isInteger(parsed))
        throw new Error(`${label} must be an integer`);
    return parsed;
}
function parseStorageResult(value) {
    const input = record(value, 'storage result');
    exactKeys(input, [
        'resourceId',
        'resourceVersionId',
        'storageIdentity',
        'checksumSha256',
        'mimeType',
        'sizeBytes',
        'width',
        'height',
        'durationSeconds',
    ], 'storage result');
    const sizeBytes = input.sizeBytes;
    if (typeof sizeBytes !== 'number' || !Number.isInteger(sizeBytes) || sizeBytes < 0) {
        throw new Error('storage result sizeBytes must be a non-negative integer');
    }
    const checksumSha256 = requiredString(input.checksumSha256, 'storage result checksumSha256');
    if (!/^[a-f0-9]{64}$/.test(checksumSha256)) {
        throw new Error('storage result checksumSha256 is invalid');
    }
    return {
        resourceId: requiredString(input.resourceId, 'storage result resourceId'),
        resourceVersionId: requiredString(input.resourceVersionId, 'storage result resourceVersionId'),
        storageIdentity: requiredString(input.storageIdentity, 'storage result storageIdentity'),
        checksumSha256,
        mimeType: requiredString(input.mimeType, 'storage result mimeType'),
        sizeBytes,
        ...(optionalPositiveInteger(input.width, 'storage result width') === undefined
            ? {}
            : { width: optionalPositiveInteger(input.width, 'storage result width') }),
        ...(optionalPositiveInteger(input.height, 'storage result height') === undefined
            ? {}
            : { height: optionalPositiveInteger(input.height, 'storage result height') }),
        ...(optionalPositiveNumber(input.durationSeconds, 'storage result durationSeconds') === undefined
            ? {}
            : { durationSeconds: optionalPositiveNumber(input.durationSeconds, 'storage result durationSeconds') }),
    };
}
export function parseReconcileOutputV1(value) {
    const input = record(value, 'storage reconciliation input');
    exactKeys(input, [
        'executionId',
        'attemptId',
        'authorizationRef',
        'safeProviderOutputRef',
        'mimeType',
        'fixtureScenario',
    ], 'storage reconciliation input');
    const fixtureScenario = input.fixtureScenario;
    if (fixtureScenario !== undefined && !fixtureScenarios.has(fixtureScenario)) {
        throw new Error('storage reconciliation input fixtureScenario is invalid');
    }
    return {
        executionId: requiredString(input.executionId, 'storage reconciliation input executionId'),
        attemptId: requiredString(input.attemptId, 'storage reconciliation input attemptId'),
        authorizationRef: requiredString(input.authorizationRef, 'storage reconciliation input authorizationRef'),
        safeProviderOutputRef: requiredString(input.safeProviderOutputRef, 'storage reconciliation input safeProviderOutputRef'),
        mimeType: requiredString(input.mimeType, 'storage reconciliation input mimeType'),
        ...(fixtureScenario === undefined ? {} : { fixtureScenario: fixtureScenario }),
    };
}
export function parseOutputReconciliationV1(value) {
    const input = record(value, 'storage reconciliation result');
    const status = requiredString(input.status, 'storage reconciliation result status');
    if (status === 'completed') {
        exactKeys(input, ['status', 'result'], 'storage reconciliation completed result');
        return { status, result: parseStorageResult(input.result) };
    }
    if (status === 'pending') {
        exactKeys(input, ['status', 'retryAfterSeconds'], 'storage reconciliation pending result');
        const retryAfterSeconds = input.retryAfterSeconds;
        if (typeof retryAfterSeconds !== 'number' ||
            !Number.isInteger(retryAfterSeconds) ||
            retryAfterSeconds < 1 ||
            retryAfterSeconds > 300) {
            throw new Error('storage reconciliation retryAfterSeconds must be an integer from 1 to 300');
        }
        return { status, retryAfterSeconds };
    }
    if (status === 'failed') {
        exactKeys(input, ['status', 'errorCode', 'retryable'], 'storage reconciliation failed result');
        if (typeof input.retryable !== 'boolean') {
            throw new Error('storage reconciliation failed result retryable must be boolean');
        }
        return {
            status,
            errorCode: requiredString(input.errorCode, 'storage reconciliation failed result errorCode'),
            retryable: input.retryable,
        };
    }
    throw new Error('storage reconciliation result status is invalid');
}
//# sourceMappingURL=dependencies.js.map