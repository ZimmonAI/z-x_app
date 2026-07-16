import type { ExecutionRequestV1,OperationType } from '../contracts/v1/execution.js';import type { RouteSnapshotV1,CapacitySnapshotV1,StorageResultV1 } from '../contracts/v1/dependencies.js';
export interface AdapterContext{request:ExecutionRequestV1;route:RouteSnapshotV1;capacity:CapacitySnapshotV1;executionId:string;signal:AbortSignal;completeMedia:(mimeType:string)=>Promise<StorageResultV1>}
export interface AdapterOutput{promptText?:string;media?:StorageResultV1;safeProviderOutputRef?:string}
export interface ExecutionAdapter{readonly operation:OperationType;readonly id:string;readonly version:'1.0.0';execute(ctx:AdapterContext):Promise<AdapterOutput>}
