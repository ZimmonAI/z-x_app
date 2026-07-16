import { loadConfig } from '../../src/config.js';

test('defaults every production capability closed', () => {
  const config = loadConfig({ ZX_NODE_ENV: 'test' });
  expect(config.ZX_API_PORT).toBeUndefined();
  expect(config.ZX_FEATURE_REAL_DEPENDENCIES_ENABLED).toBe(false);
  expect(config.ZX_FEATURE_CALLBACKS_ENABLED).toBe(false);
  expect(config.ZX_FEATURE_IMAGE_PROMPT_PREPARE_ENABLED).toBe(false);
  expect(config.ZX_FEATURE_IMAGE_GENERATE_ENABLED).toBe(false);
  expect(config.ZX_FEATURE_SCENE_VIDEO_PROMPT_PREPARE_ENABLED).toBe(false);
  expect(config.ZX_FEATURE_SCENE_VIDEO_GENERATE_ENABLED).toBe(false);
  expect(config.ZX_CANARY_PERCENT).toBe(0);
});

test('fails closed for incomplete real dependency configuration', () => {
  expect(() =>
    loadConfig({
      ZX_NODE_ENV: 'test',
      ZX_FEATURE_REAL_DEPENDENCIES_ENABLED: 'true',
    }),
  ).toThrow(/required/);
});

test('heartbeat must remain shorter than the execution lease', () => {
  expect(() =>
    loadConfig({
      ZX_NODE_ENV: 'test',
      ZX_WORKER_LEASE_SECONDS: '60',
      ZX_WORKER_HEARTBEAT_SECONDS: '60',
    }),
  ).toThrow(/heartbeat interval/);
});
