import { AutoHubFixtureV1 } from '../../fixtures/v1/auto-hub.js';
import { ZAccountFixtureV1 } from '../../fixtures/v1/z-account.js';
import { ZProviderFixtureV1 } from '../../fixtures/v1/z-provider.js';
import { ZStorageFixtureV1 } from '../../fixtures/v1/z-s.js';
import { ExecutionsRepository } from '../../src/persistence/repositories/executions.js';
import { claimNext } from '../../src/worker/claim.js';
import { completeClaimedExecution, prepareNextExecution } from '../../src/worker/lifecycle.js';
import { validRequest } from '../unit/test-request.js';
import { reset, testPool } from './db-helper.js';
function imageStorageRequest() {
    return {
        ...validRequest('image.generate.v1'),
        safeScalarInputs: { prompt: 'cinematic sunrise' },
        requestedOutputType: 'image/png',
        storageOutput: {
            contractVersion: 'zx.storage-output.v1',
            mode: 'post-run-ingest',
            artifactKind: 'image',
            acceptedMimeTypes: ['image/png'],
            storageProfileRef: 'zs-profile:fixture.default',
            maxBytes: 1048576,
        },
    };
}
test('successful media execution persists provider output and authorization references', async () => {
    const pool = testPool();
    await reset(pool);
    const dependencies = {
        routes: new ZProviderFixtureV1(),
        capacity: new ZAccountFixtureV1(),
        autoHub: new AutoHubFixtureV1(),
        storage: new ZStorageFixtureV1(),
    };
    const submitted = await new ExecutionsRepository(pool).submit(imageStorageRequest());
    if (submitted.kind !== 'created')
        throw new Error('expected created execution');
    await prepareNextExecution(pool, 'worker-prepare', 60, dependencies);
    const claim = await claimNext(pool, 'worker-run');
    if (!claim)
        throw new Error('expected claim');
    await completeClaimedExecution(pool, claim, 'worker-run', dependencies);
    const stored = await pool.query(`select safe_provider_output_ref, output_authorization_ref
       from execution.execution_attempts
      where id=$1`, [claim.attemptId]);
    expect(stored.rows[0]?.safe_provider_output_ref).toBeTruthy();
    expect(stored.rows[0]?.output_authorization_ref).toContain(claim.attemptId);
    await pool.end();
});
//# sourceMappingURL=storage-output-reference-persistence.test.js.map