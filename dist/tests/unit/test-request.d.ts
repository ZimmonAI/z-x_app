export declare function validRequest(operation?: string): {
    requestFingerprint: string;
    contractVersion: string;
    ownerApp: string;
    ownerActionId: string;
    idempotencyKey: string;
    operationType: string;
    frozenInputResources: never[];
    safeScalarInputs: {
        scene: string;
    };
    routeLocks: {
        provider: string;
        model: string;
        tool: string;
        software: string;
        runMode: string;
    };
    requestedOutputType: string;
    validationExpectations: {};
    timeoutPolicy: {
        timeoutSeconds: number;
    };
    retryPolicy: {
        maxAttempts: number;
    };
    priority: number;
    correlation: {};
    traceId: string;
};
