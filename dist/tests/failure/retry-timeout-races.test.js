import { canTransition } from '../../src/contracts/v1/lifecycle.js';
test('timeout retry requires manual reconciliation case', () => { expect(canTransition('timed-out', 'queued')).toBe(false); expect(canTransition('timed-out', 'queued', true)).toBe(true); });
//# sourceMappingURL=retry-timeout-races.test.js.map