import { SafeExecutionError } from '../../src/contracts/v1/error.js';
import { ADAPTER_ALLOWLIST } from '../../src/security/allowlist.js';
export class ZProviderFixtureV1 {
    fixtureVersion = 'fixture-v1';
    async resolveAndValidateRoute(i, _s) { const fail = (family, code) => { throw new SafeExecutionError({ family, code, message: code, retryable: false, traceId: 'fixture' }); }; if (i.fixtureScenario === 'route-not-found')
        fail('route-not-found', 'ZX_ROUTE_NOT_FOUND'); if (i.fixtureScenario === 'route-deactivated')
        fail('route-deactivated', 'ZX_ROUTE_DEACTIVATED'); if (i.fixtureScenario === 'invalid-parameters')
        fail('route-parameter-validation', 'ZX_ROUTE_PARAMETERS_INVALID'); const b = ADAPTER_ALLOWLIST[i.operation]; return { routeId: `fixture-route-${i.operation}`, routeVersion: '1.0.0', operation: i.operation, provider: i.routeLocks.provider ?? 'AUTO', model: i.routeLocks.model ?? 'AUTO', tool: i.routeLocks.tool ?? 'AUTO', software: i.routeLocks.software ?? 'AUTO', runMode: i.routeLocks.runMode ?? 'AUTO', adapterId: b.id, adapterVersion: b.version, invocationMode: 'fixture', parameterSchemaDigest: 'a'.repeat(64), timeoutClass: 'standard', resourceClass: 'standard', authSessionMethodClass: 'fixture', resolvedAt: new Date(0).toISOString() }; }
}
//# sourceMappingURL=z-provider.js.map