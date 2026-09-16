import { ExecutionRequestV1Schema, type ExecutionRequestV1 } from '../contracts/v1/execution.js';

const MAX_BODY_BYTES = 256 * 1024;
const MAX_PAYLOAD_BYTES = 64 * 1024;
const MAX_DEPTH = 8;
const MAX_STRING_LENGTH = 4096;

function inspect(value: unknown, depth = 0): void {
  if (depth > MAX_DEPTH) throw new Error('JSON depth exceeds 8');
  if (typeof value === 'string' && value.length > MAX_STRING_LENGTH) {
    throw new Error('string exceeds 4096');
  }
  if (value && typeof value === 'object') {
    for (const child of Array.isArray(value) ? value : Object.values(value)) {
      inspect(child, depth + 1);
    }
  }
}

export function validateExecutionRequest(input: unknown): ExecutionRequestV1 {
  const raw = JSON.stringify(input);
  if (Buffer.byteLength(raw) > MAX_BODY_BYTES) throw new Error('request body exceeds 256 KiB');
  const parsed = ExecutionRequestV1Schema.parse(input);
  const payload = JSON.stringify(parsed.payload);
  if (Buffer.byteLength(payload) > MAX_PAYLOAD_BYTES) throw new Error('payload JSON exceeds 64 KiB');
  inspect(parsed.payload);
  return parsed;
}
