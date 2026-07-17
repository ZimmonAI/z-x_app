import { rejectArbitraryExecutionInput } from '../../src/security/allowlist.js';
import { loadConfig } from '../../src/config.js';
test('resource/process boundaries reject arbitrary host authority', () => { expect(() => rejectArbitraryExecutionInput({ command: 'rm -rf /' })).toThrow(); expect(loadConfig({ ZX_WORKER_CONCURRENCY: '32' }).ZX_WORKER_CONCURRENCY).toBe(32); expect(() => loadConfig({ ZX_WORKER_CONCURRENCY: '33' })).toThrow(); });
//# sourceMappingURL=resource-limits.test.js.map