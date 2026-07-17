import type { OwnerDeliveryV1, OwnerDeliveryReceiptV1 } from '../contracts/v1/dependencies.js';
export interface VideoMakerExecutionPort {
    deliverResult(i: OwnerDeliveryV1, s: AbortSignal): Promise<OwnerDeliveryReceiptV1>;
}
export declare function createRealVideoMakerPort(): VideoMakerExecutionPort;
