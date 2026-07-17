import type { ZAccountCapacityClient } from '../../src/clients/z-account.js';
import type { AcquireCapacityV1, RenewCapacityV1, ReleaseCapacityV1, ReportCapacityOutcomeV1, CapacitySnapshotV1 } from '../../src/contracts/v1/dependencies.js';
export declare class ZAccountFixtureV1 implements ZAccountCapacityClient {
    readonly fixtureVersion = "fixture-v1";
    acquire(i: AcquireCapacityV1, _s: AbortSignal): Promise<CapacitySnapshotV1>;
    renew(i: RenewCapacityV1, _s: AbortSignal): Promise<{
        leaseRef: string;
        runtimeBindingRef: string;
        acquiredAt: string;
        expiresAt: string;
        eligibilityOutcome: "eligible";
        requirementDigest: string;
    }>;
    release(_i: ReleaseCapacityV1, _s: AbortSignal): Promise<void>;
    reportOutcome(_i: ReportCapacityOutcomeV1, _s: AbortSignal): Promise<void>;
}
