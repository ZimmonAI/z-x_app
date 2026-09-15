import { CONTRACT_VERSION } from '../contracts/v2/execution.js';
import type {
  ExecutionActionResult,
  ExecutionRecord,
  ExecutionService,
} from './routes/executions.js';

function isGenericExecutionRequest(input: unknown): boolean {
  return (
    typeof input === 'object' &&
    input !== null &&
    'contractVersion' in input &&
    (input as { contractVersion?: unknown }).contractVersion === CONTRACT_VERSION
  );
}

export class GenericAwareExecutionService implements ExecutionService {
  constructor(
    private readonly legacy: ExecutionService,
    private readonly generic: ExecutionService,
  ) {}

  async submit(owner: string, input: unknown) {
    return isGenericExecutionRequest(input)
      ? this.generic.submit(owner, input)
      : this.legacy.submit(owner, input);
  }

  async get(owner: string, id: string): Promise<ExecutionRecord | null> {
    const generic = await this.generic.get(owner, id);
    return generic ?? this.legacy.get(owner, id);
  }

  async cancel(owner: string, id: string): Promise<ExecutionActionResult | null> {
    const generic = await this.generic.cancel(owner, id);
    return generic ?? this.legacy.cancel(owner, id);
  }

  async retry(owner: string, id: string): Promise<ExecutionActionResult | null> {
    const generic = await this.generic.get(owner, id);
    return generic ? this.generic.retry(owner, id) : this.legacy.retry(owner, id);
  }

  async reconcile(owner: string, id: string): Promise<ExecutionActionResult | null> {
    const generic = await this.generic.get(owner, id);
    return generic ? this.generic.reconcile(owner, id) : this.legacy.reconcile(owner, id);
  }
}
