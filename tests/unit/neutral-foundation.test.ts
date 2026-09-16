import { describe, expect, test } from 'vitest';
import { loadConfig } from '../../src/config.js';
import { parseWorkerStopRequest } from '../../src/worker/control.js';

describe('neutral platform primitives', () => {
  test('keeps one neutral runtime configuration surface', () => {
    const config = loadConfig({
      ZX_NODE_ENV: 'test',
      ZX_FEATURE_IMAGE_GENERATE_ENABLED: 'true',
      ZX_Z_S_BASE_URL: 'https://legacy.invalid',
    });
    expect(config.ZX_FEATURE_NEUTRAL_FOUNDATION_ONLY).toBe(true);
    expect('ZX_FEATURE_IMAGE_GENERATE_ENABLED' in config).toBe(false);
    expect('ZX_Z_S_BASE_URL' in config).toBe(false);
  });

  test('preserves safe worker stop-control parsing', () => {
    const parsed = parseWorkerStopRequest(JSON.stringify({
      requestId: '123e4567-e89b-42d3-a456-426614174000',
      requestedAt: '2026-09-17T00:00:00.000Z',
    }));
    expect(parsed.requestId).toBe('123e4567-e89b-42d3-a456-426614174000');
  });
});
