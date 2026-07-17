import { ExecutionRequestV1Schema } from '../../src/contracts/v1/execution.js';
import { ExecutionResultV1Schema } from '../../src/contracts/v1/result.js';
import { SafeErrorV1Schema } from '../../src/contracts/v1/error.js';
import { validRequest } from './test-request.js';
test('accepts exact v1 request and bounded result/error', () => { expect(ExecutionRequestV1Schema.parse(validRequest()).contractVersion).toBe('zx.execution.v1'); expect(SafeErrorV1Schema.parse({ family: 'timeout', code: 'T', message: 'safe', retryable: true, traceId: 't' }).family).toBe('timeout'); expect(() => ExecutionResultV1Schema.parse({})).toThrow(); });
//# sourceMappingURL=contracts-v1.test.js.map