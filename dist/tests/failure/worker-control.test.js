import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { observeWorkerStopRequest, parseWorkerStopRequest, readWorkerStopAcknowledgement, workerControlPaths, writeWorkerStopAcknowledgement, writeWorkerStopRequest, } from '../../src/worker/control.js';
import { requestWorkerStop, waitForWorkerStopAcknowledgement } from '../../src/worker/request-stop.js';
import { ShutdownController } from '../../src/worker/shutdown.js';
const request = {
    requestId: '00000000-0000-4000-8000-000000000003',
    requestedAt: '2026-07-16T00:00:00.000Z',
};
function delay(milliseconds) {
    return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
test('worker control invokes the existing shutdown controller and removes the request', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'zx-worker-control-'));
    try {
        const shutdown = new ShutdownController();
        await writeWorkerStopRequest(directory, request);
        const consumed = await observeWorkerStopRequest(directory, () => shutdown.begin());
        expect(consumed).toEqual(request);
        expect(shutdown.isStopping).toBe(true);
        await expect(readFile(workerControlPaths(directory).requestPath, 'utf8')).rejects.toMatchObject({
            code: 'ENOENT',
        });
    }
    finally {
        await rm(directory, { recursive: true, force: true });
    }
});
test('idle and active work drain through the existing 30-second-capable controller', async () => {
    const idle = new ShutdownController();
    idle.begin();
    expect(await idle.drain(25)).toBe(true);
    const active = new ShutdownController();
    active.begin();
    active.track(delay(20));
    expect(await active.drain(30_000)).toBe(true);
    const timedOut = new ShutdownController();
    timedOut.begin();
    timedOut.track(new Promise(() => undefined));
    expect(await timedOut.drain(5)).toBe(false);
});
test('matching acknowledgement is safe, consumed deterministically, and reports drain failure', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'zx-worker-control-'));
    try {
        await writeWorkerStopAcknowledgement(directory, {
            requestId: request.requestId,
            result: 'drain-timeout',
            requestedAt: request.requestedAt,
            shutdownStartedAt: '2026-07-16T00:00:01.000Z',
            acknowledgedAt: '2026-07-16T00:00:31.000Z',
        });
        const raw = await readFile(workerControlPaths(directory).acknowledgementPath, 'utf8');
        expect(raw).not.toMatch(/token|secret|password|database|connection/i);
        const acknowledgement = await waitForWorkerStopAcknowledgement({
            controlDir: directory,
            requestId: request.requestId,
            timeoutMilliseconds: 50,
            pollMilliseconds: 1,
        });
        expect(acknowledgement.result).toBe('drain-timeout');
        expect(await readWorkerStopAcknowledgement(directory)).toBeUndefined();
    }
    finally {
        await rm(directory, { recursive: true, force: true });
    }
});
test('stop wait times out nonzero and removes its still-pending request', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'zx-worker-control-'));
    try {
        await writeWorkerStopRequest(directory, request);
        await expect(waitForWorkerStopAcknowledgement({
            controlDir: directory,
            requestId: request.requestId,
            timeoutMilliseconds: 5,
            pollMilliseconds: 1,
        })).rejects.toThrow(/timed out/);
        await expect(readFile(workerControlPaths(directory).requestPath, 'utf8')).rejects.toMatchObject({
            code: 'ENOENT',
        });
    }
    finally {
        await rm(directory, { recursive: true, force: true });
    }
});
test('request command treats drain-timeout as a failed stop outcome', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'zx-worker-control-'));
    try {
        const stopPromise = requestWorkerStop(directory);
        const rejection = expect(stopPromise).rejects.toThrow(/drain-timeout/);
        let observed;
        for (let attempt = 0; attempt < 100 && !observed; attempt += 1) {
            try {
                observed = parseWorkerStopRequest(await readFile(workerControlPaths(directory).requestPath, 'utf8'));
            }
            catch (error) {
                if (error.code !== 'ENOENT')
                    throw error;
                await delay(1);
            }
        }
        if (!observed)
            throw new Error('worker stop request not observed');
        await writeWorkerStopAcknowledgement(directory, {
            requestId: observed.requestId,
            result: 'drain-timeout',
            requestedAt: observed.requestedAt,
            shutdownStartedAt: new Date().toISOString(),
            acknowledgedAt: new Date().toISOString(),
        });
        await rejection;
        expect(await readWorkerStopAcknowledgement(directory)).toBeUndefined();
    }
    finally {
        await rm(directory, { recursive: true, force: true });
    }
});
//# sourceMappingURL=worker-control.test.js.map