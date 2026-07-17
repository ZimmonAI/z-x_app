import type { VideoMakerExecutionPort } from '../../src/clients/video-maker.js';
import type { OwnerDeliveryV1, OwnerDeliveryReceiptV1 } from '../../src/contracts/v1/dependencies.js';
export declare class VideoMakerFixtureV1 implements VideoMakerExecutionPort {
    readonly fixtureVersion = "fixture-v1";
    deliverResult(i: OwnerDeliveryV1, _s: AbortSignal): Promise<OwnerDeliveryReceiptV1>;
}
