import type { OperationType } from '../../src/contracts/v1/execution.js';
export declare function validRequest(operation?: OperationType): {
    requestFingerprint: string;
    contractVersion: string;
    ownerApp: string;
    ownerActionId: string;
    idempotencyKey: string;
    operationType: "image_prompt.prepare.v1" | "image.generate.v1" | "scene_video_prompt.prepare.v1" | "scene_video.generate.v1";
    frozenInputResources: never[];
    safeScalarInputs: {
        scene: string;
        fixtureScenario: string;
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
