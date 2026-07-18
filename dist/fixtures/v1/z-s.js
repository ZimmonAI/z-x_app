import { SafeExecutionError } from '../../src/contracts/v1/error.js';
export class ZStorageFixtureV1 {
    fixtureVersion = 'fixture-v1';
    async createOutputAuthorization(i, _s) { if (i.mode === 'direct-write')
        throw new SafeExecutionError({ family: 'adapter-unavailable', code: 'ZX_DIRECT_WRITE_UNSUPPORTED', message: 'fixture direct-write is unsupported', retryable: false, traceId: 'fixture' }); return { authorizationRef: `outauth_${i.executionId}_${i.attemptId}`, uploadRef: `upload_${i.attemptId}`, expiresAt: new Date(60000).toISOString() }; }
    async completeOrIngestOutput(i, _s) { if (i.fixtureScenario === 'storage-failure')
        throw new SafeExecutionError({ family: 'storage-output-failure', code: 'ZX_STORAGE_FAILURE', message: 'fixture storage failure', retryable: true, traceId: 'fixture' }); const video = i.mimeType.startsWith('video/'); return { resourceId: 'resource_fixture_0001', resourceVersionId: 'version_fixture_0001', storageIdentity: 'zs://fixture/resource_fixture_0001/version_fixture_0001', checksumSha256: 'c'.repeat(64), mimeType: i.mimeType, sizeBytes: video ? 1024 : 512, width: 1024, height: 1024, ...(video ? { durationSeconds: 5 } : {}) }; }
    async createReadGrant(i, _s) { return { readGrantRef: `read_${i.resourceId}`, expiresAt: new Date(60000).toISOString() }; }
}
//# sourceMappingURL=z-s.js.map