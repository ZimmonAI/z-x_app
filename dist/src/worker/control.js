import { link, mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
export const WORKER_STOP_REQUEST_FILE = 'stop.request.json';
export const WORKER_STOP_ACK_FILE = 'stop.ack.json';
function isSafeRequestId(value) {
    return typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(value);
}
function isIsoTimestamp(value) {
    return typeof value === 'string' && Number.isFinite(Date.parse(value));
}
export function parseWorkerStopRequest(contents) {
    let value;
    try {
        value = JSON.parse(contents);
    }
    catch {
        throw new Error('worker stop request malformed');
    }
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new Error('worker stop request malformed');
    }
    const request = value;
    if (Object.keys(request).sort().join(',') !== 'requestId,requestedAt' ||
        !isSafeRequestId(request.requestId) ||
        !isIsoTimestamp(request.requestedAt)) {
        throw new Error('worker stop request invalid');
    }
    return { requestId: request.requestId, requestedAt: request.requestedAt };
}
export function parseWorkerStopAcknowledgement(contents) {
    let value;
    try {
        value = JSON.parse(contents);
    }
    catch {
        throw new Error('worker stop acknowledgement malformed');
    }
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new Error('worker stop acknowledgement malformed');
    }
    const acknowledgement = value;
    if (Object.keys(acknowledgement).sort().join(',') !==
        'acknowledgedAt,requestId,requestedAt,result,shutdownStartedAt' ||
        !isSafeRequestId(acknowledgement.requestId) ||
        (acknowledgement.result !== 'drained' && acknowledgement.result !== 'drain-timeout') ||
        !isIsoTimestamp(acknowledgement.requestedAt) ||
        !isIsoTimestamp(acknowledgement.shutdownStartedAt) ||
        !isIsoTimestamp(acknowledgement.acknowledgedAt)) {
        throw new Error('worker stop acknowledgement invalid');
    }
    return acknowledgement;
}
export function workerControlPaths(controlDir) {
    return {
        requestPath: join(controlDir, WORKER_STOP_REQUEST_FILE),
        acknowledgementPath: join(controlDir, WORKER_STOP_ACK_FILE),
    };
}
async function removeIfPresent(path) {
    try {
        await unlink(path);
    }
    catch (error) {
        if (error.code !== 'ENOENT')
            throw error;
    }
}
async function atomicCreate(path, contents) {
    const temporaryPath = `${path}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(temporaryPath, contents, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
    try {
        await link(temporaryPath, path);
    }
    finally {
        await removeIfPresent(temporaryPath);
    }
}
export async function writeWorkerStopRequest(controlDir, request) {
    parseWorkerStopRequest(JSON.stringify(request));
    await mkdir(controlDir, { recursive: true, mode: 0o700 });
    const paths = workerControlPaths(controlDir);
    await removeIfPresent(paths.acknowledgementPath);
    try {
        await readFile(paths.requestPath, 'utf8');
        throw new Error('worker stop request already exists');
    }
    catch (error) {
        if (error.code !== 'ENOENT')
            throw error;
    }
    await atomicCreate(paths.requestPath, `${JSON.stringify(request)}\n`);
}
export async function observeWorkerStopRequest(controlDir, beginShutdown) {
    const { requestPath } = workerControlPaths(controlDir);
    let contents;
    try {
        contents = await readFile(requestPath, 'utf8');
    }
    catch (error) {
        if (error.code === 'ENOENT')
            return undefined;
        throw error;
    }
    let request;
    try {
        request = parseWorkerStopRequest(contents);
    }
    catch (error) {
        await removeIfPresent(requestPath);
        throw error;
    }
    await removeIfPresent(requestPath);
    beginShutdown();
    return request;
}
export async function writeWorkerStopAcknowledgement(controlDir, acknowledgement) {
    parseWorkerStopAcknowledgement(JSON.stringify(acknowledgement));
    await mkdir(controlDir, { recursive: true, mode: 0o700 });
    const { acknowledgementPath } = workerControlPaths(controlDir);
    await removeIfPresent(acknowledgementPath);
    await atomicCreate(acknowledgementPath, `${JSON.stringify(acknowledgement)}\n`);
}
export async function removeWorkerStopRequestIfMatching(controlDir, requestId) {
    const { requestPath } = workerControlPaths(controlDir);
    try {
        const request = parseWorkerStopRequest(await readFile(requestPath, 'utf8'));
        if (request.requestId === requestId)
            await removeIfPresent(requestPath);
    }
    catch (error) {
        if (error.code !== 'ENOENT')
            throw error;
    }
}
export async function readWorkerStopAcknowledgement(controlDir) {
    const { acknowledgementPath } = workerControlPaths(controlDir);
    try {
        return parseWorkerStopAcknowledgement(await readFile(acknowledgementPath, 'utf8'));
    }
    catch (error) {
        if (error.code === 'ENOENT')
            return undefined;
        throw error;
    }
}
export async function removeWorkerStopAcknowledgement(controlDir) {
    await removeIfPresent(workerControlPaths(controlDir).acknowledgementPath);
}
//# sourceMappingURL=control.js.map