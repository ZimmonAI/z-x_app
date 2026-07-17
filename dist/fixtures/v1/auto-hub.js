import { SafeExecutionError } from '../../src/contracts/v1/error.js';
export class AutoHubFixtureV1 {
    fixtureVersion = 'fixture-v1';
    async startRun(i, _s) { if (i.fixtureScenario === 'provider-rejected')
        throw new SafeExecutionError({ family: 'provider-rejected', code: 'ZX_PROVIDER_REJECTED', message: 'fixture provider rejected', retryable: false, traceId: 'fixture' }); if (i.fixtureScenario === 'timeout')
        throw new SafeExecutionError({ family: 'timeout', code: 'ZX_PROVIDER_TIMEOUT', message: 'fixture timeout', retryable: true, traceId: 'fixture' }); return { runRef: 'run_fixture_0001', status: 'running' }; }
    async getRun(i, _s) { if (i.fixtureScenario === 'unknown-run')
        return { runRef: i.runRef, status: 'unknown' }; return { runRef: i.runRef, status: 'succeeded', safeOutputRef: 'provider-output-fixture-0001' }; }
    async cancelRun(i, _s) { return { runRef: i.runRef, status: 'cancelled' }; }
}
//# sourceMappingURL=auto-hub.js.map