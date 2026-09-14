import {
  BundleExecutionRequestV1Schema,
  computeBundleExecutionRequestFingerprint,
  type BundleExecutionRequestV1,
} from '../contracts/bundle-owner/v1/execution.js';

const MAX_BODY_BYTES = 256 * 1024;

export function validateBundleExecutionRequest(input: unknown): BundleExecutionRequestV1 {
  const raw = JSON.stringify(input);
  if (Buffer.byteLength(raw) > MAX_BODY_BYTES) {
    throw Object.assign(new Error('request body exceeds 256 KiB'), { statusCode: 400 });
  }

  const parsed = BundleExecutionRequestV1Schema.parse(input);
  const expectedFingerprint = computeBundleExecutionRequestFingerprint({
    ownerType: parsed.ownerType,
    ownerRef: parsed.ownerRef,
    bundleVersionId: parsed.bundleVersionId,
    inputs: parsed.inputs,
    correlation: parsed.correlation,
  });
  if (parsed.requestFingerprint !== expectedFingerprint) {
    throw Object.assign(new Error('ZX_REQUEST_FINGERPRINT_MISMATCH'), { statusCode: 400 });
  }
  return parsed;
}
