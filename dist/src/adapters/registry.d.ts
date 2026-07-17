import type { OperationType } from '../contracts/v1/execution.js';
import type { ExecutionAdapter } from './types.js';
export declare function getAdapter(operation: OperationType, id?: string, version?: string, mode?: string, productionContractEnabled?: boolean): ExecutionAdapter;
export declare function listAdapters(): ExecutionAdapter[];
