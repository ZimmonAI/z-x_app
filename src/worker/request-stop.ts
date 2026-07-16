import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { loadConfig } from '../config.js';
import {
  readWorkerStopAcknowledgement,
  removeWorkerStopAcknowledgement,
  removeWorkerStopRequestIfMatching,
  writeWorkerStopRequest,
  type WorkerStopAcknowledgement,
  type WorkerStopRequest,
} from './control.js';

const WORKER_STOP_TIMEOUT_MILLISECONDS = 35_000;
const WORKER_STOP_POLL_MILLISECONDS = 100;

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export async function waitForWorkerStopAcknowledgement(options: {
  controlDir: string;
  requestId: string;
  timeoutMilliseconds?: number;
  pollMilliseconds?: number;
}): Promise<WorkerStopAcknowledgement> {
  const deadline = Date.now() + (options.timeoutMilliseconds ?? WORKER_STOP_TIMEOUT_MILLISECONDS);
  while (Date.now() < deadline) {
    const acknowledgement = await readWorkerStopAcknowledgement(options.controlDir);
    if (acknowledgement) {
      if (acknowledgement.requestId !== options.requestId) {
        await removeWorkerStopAcknowledgement(options.controlDir);
        throw new Error('worker stop acknowledgement request ID mismatch');
      }
      await removeWorkerStopAcknowledgement(options.controlDir);
      return acknowledgement;
    }
    await delay(options.pollMilliseconds ?? WORKER_STOP_POLL_MILLISECONDS);
  }
  await removeWorkerStopRequestIfMatching(options.controlDir, options.requestId);
  throw new Error('worker stop acknowledgement timed out');
}

export async function requestWorkerStop(controlDir: string): Promise<WorkerStopAcknowledgement> {
  const request: WorkerStopRequest = {
    requestId: randomUUID(),
    requestedAt: new Date().toISOString(),
  };
  await writeWorkerStopRequest(controlDir, request);
  const acknowledgement = await waitForWorkerStopAcknowledgement({
    controlDir,
    requestId: request.requestId,
  });
  if (acknowledgement.result !== 'drained') {
    throw new Error('worker stop completed with drain-timeout');
  }
  return acknowledgement;
}

export async function runWorkerStopCommand(): Promise<void> {
  const controlDir = loadConfig().ZX_WORKER_CONTROL_DIR;
  if (!controlDir) throw new Error('ZX_WORKER_CONTROL_DIR required');
  const acknowledgement = await requestWorkerStop(controlDir);
  process.stdout.write(`worker stop acknowledged: ${acknowledgement.requestId}\n`);
  process.stdout.write(`result: ${acknowledgement.result}\n`);
  process.stdout.write(`acknowledged at: ${acknowledgement.acknowledgedAt}\n`);
}

const entrypoint = process.argv[1];
if (entrypoint && import.meta.url === pathToFileURL(entrypoint).href) {
  runWorkerStopCommand().catch((error) => {
    const message = error instanceof Error ? error.message : 'unknown failure';
    process.stderr.write(`worker stop request failed: ${message}\n`);
    process.exitCode = 1;
  });
}
