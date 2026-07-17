import { SafeExecutionError } from '../../src/contracts/v1/error.js';
export class ZAccountFixtureV1 {
    fixtureVersion = 'fixture-v1';
    async acquire(i, _s) { const m = { 'no-capacity': ['no-eligible-capacity', 'ZX_NO_CAPACITY', true], 'login-required': ['login-required', 'ZX_LOGIN_REQUIRED', false], 'account-attention': ['account-attention', 'ZX_ACCOUNT_ATTENTION', false] }; const x = i.fixtureScenario && m[i.fixtureScenario]; if (x)
        throw new SafeExecutionError({ family: x[0], code: x[1], message: x[1], retryable: x[2], traceId: 'fixture' }); return { leaseRef: 'lease_fixture_0001', runtimeBindingRef: 'rb_fixture_0001', acquiredAt: new Date(0).toISOString(), expiresAt: new Date(60000).toISOString(), eligibilityOutcome: 'eligible', requirementDigest: 'b'.repeat(64) }; }
    async renew(i, _s) { return { leaseRef: i.leaseRef, runtimeBindingRef: 'rb_fixture_0001', acquiredAt: new Date(0).toISOString(), expiresAt: new Date(60000).toISOString(), eligibilityOutcome: 'eligible', requirementDigest: 'b'.repeat(64) }; }
    async release(_i, _s) { }
    async reportOutcome(_i, _s) { }
}
//# sourceMappingURL=z-account.js.map