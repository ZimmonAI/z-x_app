import { SafeExecutionError } from '../../src/contracts/v1/error.js';
export class VideoMakerFixtureV1 {
    fixtureVersion = 'fixture-v1';
    async deliverResult(i, _s) { if (i.fixtureScenario === 'callback-failure')
        throw new SafeExecutionError({ family: 'callback-failure', code: 'ZX_CALLBACK_FAILURE', message: 'fixture callback failure', retryable: true, traceId: 'fixture' }); return { deliveryRef: `delivery_${i.executionId}`, accepted: true }; }
}
//# sourceMappingURL=video-maker.js.map