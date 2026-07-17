import { canTransition } from '../../src/contracts/v1/lifecycle.js';
test('cancel race accepts only allowed persisted winner', () => { expect(canTransition('running', 'cancelled')).toBe(true); expect(canTransition('succeeded', 'cancelled')).toBe(false); });
//# sourceMappingURL=cancel-races.test.js.map