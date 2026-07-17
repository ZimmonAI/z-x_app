import { AutoHubFixtureV1 } from '../../fixtures/v1/auto-hub.js';
import { ZAccountFixtureV1 } from '../../fixtures/v1/z-account.js';
import { ZProviderFixtureV1 } from '../../fixtures/v1/z-provider.js';
import { ZStorageFixtureV1 } from '../../fixtures/v1/z-s.js';
import { loadConfig } from '../config.js';
import { SafeExecutionError } from '../contracts/v1/error.js';
import { createLogger } from '../observability/logger.js';
import { createPool } from '../persistence/pool.js';
import { claimNext } from './claim.js';
import { observeWorkerStopRequest, writeWorkerStopAcknowledgement, } from './control.js';
import { startHeartbeatLoop } from './heartbeat.js';
import { completeClaimedExecution, prepareNextExecution, } from './lifecycle.js';
import { prepareManualRetry, recoverExpiredLeases } from './reconciliation.js';
import { ShutdownController } from './shutdown.js';
const config = loadConfig();
if (!config.ZX_DATABASE_URL) {
    throw new Error('ZX_DATABASE_URL required to start worker');
}
if (config.ZX_FEATURE_REAL_DEPENDENCIES_ENABLED) {
    throw new Error('real dependency clients remain disabled pending owner-published contracts');
}
const enabledOperations = new Set();
if (config.ZX_FEATURE_IMAGE_PROMPT_PREPARE_ENABLED) {
    enabledOperations.add('image_prompt.prepare.v1');
}
if (config.ZX_FEATURE_IMAGE_GENERATE_ENABLED) {
    enabledOperations.add('image.generate.v1');
}
if (config.ZX_FEATURE_SCENE_VIDEO_PROMPT_PREPARE_ENABLED) {
    enabledOperations.add('scene_video_prompt.prepare.v1');
}
if (config.ZX_FEATURE_SCENE_VIDEO_GENERATE_ENABLED) {
    enabledOperations.add('scene_video.generate.v1');
}
const enabledOperationList = [...enabledOperations];
const logger = createLogger(config.ZX_LOG_LEVEL);
const pool = createPool(config.ZX_DATABASE_URL);
const shutdown = new ShutdownController();
const routeFixture = new ZProviderFixtureV1();
const dependencies = {
    routes: {
        async resolveAndValidateRoute(input, signal) {
            if (!enabledOperations.has(input.operation)) {
                throw new SafeExecutionError({
                    family: 'adapter-unavailable',
                    code: 'ZX_OPERATION_DISABLED',
                    message: 'operation is disabled by the worker feature gate',
                    retryable: false,
                    details: { operation: input.operation },
                    traceId: 'worker-feature-gate',
                });
            }
            return routeFixture.resolveAndValidateRoute(input, signal);
        },
    },
    capacity: new ZAccountFixtureV1(),
    autoHub: new AutoHubFixtureV1(),
    storage: new ZStorageFixtureV1(),
};
const abortControllers = new Set();
let lastRecoveryAt = 0;
let controlRequest;
let shutdownStartedAt;
function beginShutdown() {
    if (shutdown.isStopping)
        return;
    shutdown.begin();
    shutdownStartedAt = new Date().toISOString();
    logger.info({ state: 'draining' }, 'worker shutdown started');
}
async function observeControlRequest() {
    if (!config.ZX_WORKER_CONTROL_DIR || controlRequest || shutdown.isStopping)
        return;
    try {
        controlRequest = await observeWorkerStopRequest(config.ZX_WORKER_CONTROL_DIR, beginShutdown);
    }
    catch (error) {
        logger.warn({ error: error instanceof Error ? error.message : 'unknown worker control failure' }, 'worker control request ignored safely');
    }
}
process.once('SIGTERM', beginShutdown);
process.once('SIGINT', beginShutdown);
function delay(milliseconds) {
    return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
while (!shutdown.isStopping) {
    await observeControlRequest();
    if (shutdown.isStopping)
        break;
    let progressed = false;
    if (enabledOperations.size > 0) {
        progressed = await prepareManualRetry(pool, config.ZX_WORKER_ID, config.ZX_WORKER_LEASE_SECONDS, dependencies);
        if (!progressed) {
            progressed = await prepareNextExecution(pool, config.ZX_WORKER_ID, config.ZX_WORKER_LEASE_SECONDS, dependencies);
        }
    }
    while (!shutdown.isStopping && shutdown.activeCount < config.ZX_WORKER_CONCURRENCY) {
        const claim = await claimNext(pool, config.ZX_WORKER_ID, config.ZX_WORKER_LEASE_SECONDS, enabledOperationList);
        if (!claim)
            break;
        progressed = true;
        const abortController = new AbortController();
        abortControllers.add(abortController);
        const stopHeartbeat = startHeartbeatLoop({
            pool,
            attemptId: claim.attemptId,
            leaseToken: claim.leaseToken,
            leaseSeconds: config.ZX_WORKER_LEASE_SECONDS,
            heartbeatSeconds: config.ZX_WORKER_HEARTBEAT_SECONDS,
            onLeaseLost: () => abortController.abort(new Error('lease lost')),
        });
        const task = completeClaimedExecution(pool, claim, config.ZX_WORKER_ID, dependencies, abortController.signal).finally(() => {
            stopHeartbeat();
            abortControllers.delete(abortController);
        });
        void shutdown.track(task).catch((error) => {
            logger.error({ error: error instanceof Error ? error.message : 'unknown worker task failure' }, 'fixture execution task failed safely');
        });
    }
    const now = Date.now();
    if (now - lastRecoveryAt >= 30_000) {
        const recovered = await recoverExpiredLeases(pool);
        if (recovered > 0)
            logger.warn({ recovered }, 'expired execution leases recovered');
        lastRecoveryAt = now;
    }
    if (!progressed) {
        await observeControlRequest();
        if (!shutdown.isStopping)
            await delay(1_000 + Math.floor(Math.random() * 251));
    }
}
const drained = await shutdown.drain(30_000);
if (!drained) {
    for (const controller of abortControllers) {
        controller.abort(new Error('shutdown drain deadline exceeded'));
    }
    process.exitCode = 1;
    logger.error({ state: 'drain-timeout' }, 'worker shutdown drain timed out');
}
await pool.end();
if (controlRequest && config.ZX_WORKER_CONTROL_DIR && shutdownStartedAt) {
    await writeWorkerStopAcknowledgement(config.ZX_WORKER_CONTROL_DIR, {
        requestId: controlRequest.requestId,
        result: drained ? 'drained' : 'drain-timeout',
        requestedAt: controlRequest.requestedAt,
        shutdownStartedAt,
        acknowledgedAt: new Date().toISOString(),
    });
}
//# sourceMappingURL=main.js.map