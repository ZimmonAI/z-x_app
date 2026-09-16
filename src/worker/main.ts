import { loadConfig } from '../config.js';
import { createLogger } from '../observability/logger.js';
import {
  observeWorkerStopRequest,
  writeWorkerStopAcknowledgement,
  type WorkerStopRequest,
} from './control.js';
import { ShutdownController } from './shutdown.js';

const config = loadConfig();
const logger = createLogger(config.ZX_LOG_LEVEL);
const shutdown = new ShutdownController();
let controlRequest: WorkerStopRequest | undefined;
let shutdownStartedAt: string | undefined;

function beginShutdown(): void {
  if (shutdown.isStopping) return;
  shutdown.begin();
  shutdownStartedAt = new Date().toISOString();
  logger.info({ state: 'draining' }, 'neutral worker shutdown started');
}

async function observeControlRequest(): Promise<void> {
  if (!config.ZX_WORKER_CONTROL_DIR || controlRequest || shutdown.isStopping) return;
  try {
    controlRequest = await observeWorkerStopRequest(config.ZX_WORKER_CONTROL_DIR, beginShutdown);
  } catch (error) {
    logger.warn(
      { error: error instanceof Error ? error.message : 'unknown worker control failure' },
      'worker control request ignored safely',
    );
  }
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

process.once('SIGTERM', beginShutdown);
process.once('SIGINT', beginShutdown);

logger.info(
  { state: 'neutral-foundation', claimsEnabled: false },
  'worker started without an execution-method runtime',
);

while (!shutdown.isStopping) {
  await observeControlRequest();
  if (!shutdown.isStopping) await delay(1_000);
}

const drained = await shutdown.drain(30_000);
if (!drained) {
  process.exitCode = 1;
  logger.error({ state: 'drain-timeout' }, 'neutral worker shutdown drain timed out');
}

if (controlRequest && config.ZX_WORKER_CONTROL_DIR && shutdownStartedAt) {
  await writeWorkerStopAcknowledgement(config.ZX_WORKER_CONTROL_DIR, {
    requestId: controlRequest.requestId,
    result: drained ? 'drained' : 'drain-timeout',
    requestedAt: controlRequest.requestedAt,
    shutdownStartedAt,
    acknowledgedAt: new Date().toISOString(),
  });
}
