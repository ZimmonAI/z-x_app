import { BUNDLE_OWNER_CONTRACT_VERSION, type BundleOwnerExecutionV1 } from '../contracts/v1/bundle-owner.js';
import type { BundleOwnerExecutionService } from './bundle-owner-execution-service.js';
import type {
  ExecutionActionResult,
  ExecutionRecord,
  ExecutionService,
} from './routes/executions.js';

function isBundleOwnerRequest(input: unknown): boolean {
  return (
    typeof input === 'object' &&
    input !== null &&
    'contractVersion' in input &&
    (input as { contractVersion?: unknown }).contractVersion === BUNDLE_OWNER_CONTRACT_VERSION
  );
}

function asExecutionRecord(execution: BundleOwnerExecutionV1): ExecutionRecord {
  // executionRoutes only transports the returned object. Keep the bundle contract's
  // normalized safe shape intact rather than widening it to legacy internal fields.
  return execution as unknown as ExecutionRecord;
}

export class BundleAwareExecutionService implements ExecutionService {
  constructor(
    private readonly legacy: ExecutionService,
    private readonly bundles: BundleOwnerExecutionService,
  ) {}

  async submit(owner: string, input: unknown) {
    if (!isBundleOwnerRequest(input)) return this.legacy.submit(owner, input);
    const result = await this.bundles.submit(owner, input);
    return { code: result.code, record: asExecutionRecord(result.execution) };
  }

  async get(owner: string, id: string): Promise<ExecutionRecord | null> {
    const bundle = await this.bundles.get(owner, id);
    if (bundle) return asExecutionRecord(bundle);
    return this.legacy.get(owner, id);
  }

  async cancel(owner: string, id: string): Promise<ExecutionActionResult | null> {
    const bundle = await this.bundles.cancel(owner, id);
    if (bundle) {
      return { code: bundle.code, record: asExecutionRecord(bundle.execution) };
    }
    return this.legacy.cancel(owner, id);
  }

  retry(owner: string, id: string): Promise<ExecutionActionResult | null> {
    return this.legacy.retry(owner, id);
  }

  reconcile(owner: string, id: string): Promise<ExecutionActionResult | null> {
    return this.legacy.reconcile(owner, id);
  }
}
