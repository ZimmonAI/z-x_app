import { AutoHubFixtureV1 } from '../../fixtures/v1/auto-hub.js';
import { ZAccountFixtureV1 } from '../../fixtures/v1/z-account.js';
import { ZProviderFixtureV1 } from '../../fixtures/v1/z-provider.js';
import { ZStorageFixtureV1 } from '../../fixtures/v1/z-s.js';
import { createRealZStorageClient } from '../../src/clients/z-s.js';
import { ZStorageHttpClient } from '../../src/clients/z-s-http.js';
import { loadConfig } from '../../src/config.js';

test('fixture storage remains the default', () => {
  const config = loadConfig({ ZX_NODE_ENV: 'test' });
  expect(config.ZX_FEATURE_REAL_Z_S_ENABLED).toBe(false);
  expect(new ZStorageFixtureV1()).toBeInstanceOf(ZStorageFixtureV1);
});

test('real Z-s requires only its own URL and bearer token', () => {
  const config = loadConfig({
    ZX_NODE_ENV: 'test',
    ZX_FEATURE_REAL_Z_S_ENABLED: 'true',
    ZX_Z_S_BASE_URL: 'https://z-s.example.test/',
    ZX_Z_S_BEARER_TOKEN: 'server-only-token',
  });

  expect(config.ZX_FEATURE_REAL_Z_S_ENABLED).toBe(true);
  expect(config.ZX_FEATURE_REAL_DEPENDENCIES_ENABLED).toBe(false);
  expect(config.ZX_Z_PROVIDER_BASE_URL).toBeUndefined();
  expect(config.ZX_Z_ACCOUNT_BASE_URL).toBeUndefined();
  expect(config.ZX_AUTO_HUB_BASE_URL).toBeUndefined();
  expect(
    createRealZStorageClient({
      baseUrl: config.ZX_Z_S_BASE_URL ?? '',
      bearerToken: config.ZX_Z_S_BEARER_TOKEN ?? '',
    }),
  ).toBeInstanceOf(ZStorageHttpClient);
});

test('real Z-s composes while route, capacity, and Auto-Hub remain fixtures', () => {
  const dependencies = {
    routes: new ZProviderFixtureV1(),
    capacity: new ZAccountFixtureV1(),
    autoHub: new AutoHubFixtureV1(),
    storage: createRealZStorageClient({
      baseUrl: 'https://z-s.example.test',
      bearerToken: 'server-only-token',
    }),
  };

  expect(dependencies.routes).toBeInstanceOf(ZProviderFixtureV1);
  expect(dependencies.capacity).toBeInstanceOf(ZAccountFixtureV1);
  expect(dependencies.autoHub).toBeInstanceOf(AutoHubFixtureV1);
  expect(dependencies.storage).toBeInstanceOf(ZStorageHttpClient);
});

test('real Z-s configuration fails safely for a malformed URL or missing token', () => {
  expect(() =>
    loadConfig({
      ZX_NODE_ENV: 'test',
      ZX_FEATURE_REAL_Z_S_ENABLED: 'true',
      ZX_Z_S_BASE_URL: 'ftp://storage.example.test',
      ZX_Z_S_BEARER_TOKEN: 'server-only-token',
    }),
  ).toThrow(/HTTP or HTTPS/);

  expect(() =>
    loadConfig({
      ZX_NODE_ENV: 'test',
      ZX_FEATURE_REAL_Z_S_ENABLED: 'true',
      ZX_Z_S_BASE_URL: 'https://z-s.example.test',
    }),
  ).toThrow(/bearer token/);
});

test('configuration failures never include the bearer token', () => {
  const bearerToken = 'do-not-expose-this-token';
  try {
    loadConfig({
      ZX_NODE_ENV: 'test',
      ZX_FEATURE_REAL_Z_S_ENABLED: 'true',
      ZX_Z_S_BASE_URL: 'ftp://storage.example.test',
      ZX_Z_S_BEARER_TOKEN: bearerToken,
    });
    throw new Error('expected configuration to fail');
  } catch (error) {
    expect(String(error)).not.toContain(bearerToken);
  }
});
