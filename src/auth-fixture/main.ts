import { loadConfig } from '../config.js';
import { loadFixtureAuthRuntimeConfig } from './config.js';
import { buildFixtureAuthServer } from './server.js';

try {
  const config = loadFixtureAuthRuntimeConfig(loadConfig());
  const app = buildFixtureAuthServer(config);
  const close = async () => {
    await app.close();
  };
  process.once('SIGTERM', () => void close());
  process.once('SIGINT', () => void close());
  await app.listen({ host: config.bindHost, port: config.port });
} catch {
  process.stderr.write('fixture auth startup failed safely\n');
  process.exitCode = 1;
}
