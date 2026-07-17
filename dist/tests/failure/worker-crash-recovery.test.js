import { ShutdownController } from '../../src/worker/shutdown.js';
test('shutdown drains bounded work', async () => { const c = new ShutdownController(); c.begin(); expect(c.isStopping).toBe(true); expect(await c.drain(new Set([Promise.resolve()]), 50)).toBe(true); });
//# sourceMappingURL=worker-crash-recovery.test.js.map