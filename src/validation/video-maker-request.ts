import {
  VideoMakerExecutionRequestV1Schema,
  freezeAcceptedVideoMakerExecutionRequestV1,
  type VideoMakerExecutionRequestV1,
} from '../contracts/video-maker/v1/execution.js';

const MAX_VIDEO_MAKER_REQUEST_BODY_BYTES = 256 * 1024;
const MAX_VIDEO_MAKER_REQUEST_DEPTH = 10;

function inspectDepth(value: unknown, depth = 0): void {
  if (depth > MAX_VIDEO_MAKER_REQUEST_DEPTH) {
    throw new Error('video-maker request JSON depth exceeds 10');
  }
  if (!value || typeof value !== 'object') return;
  for (const child of Array.isArray(value) ? value : Object.values(value)) {
    inspectDepth(child, depth + 1);
  }
}

export function validateVideoMakerExecutionRequest(input: unknown): VideoMakerExecutionRequestV1 {
  const serialized = JSON.stringify(input);
  if (Buffer.byteLength(serialized, 'utf8') > MAX_VIDEO_MAKER_REQUEST_BODY_BYTES) {
    throw new Error('video-maker request body exceeds 256 KiB');
  }
  inspectDepth(input);
  return freezeAcceptedVideoMakerExecutionRequestV1(VideoMakerExecutionRequestV1Schema.parse(input));
}
