import type { OperationType } from './execution.js';
export interface RouteSnapshotV1 { routeId:string; routeVersion:string; operation:OperationType; provider:string; model:string; tool:string; software:string; runMode:string; adapterId:string; adapterVersion:string; invocationMode:'auto-hub'|'http-json'|'cli'|'fixture'; parameterSchemaDigest:string; timeoutClass:string; resourceClass:string; authSessionMethodClass:string; resolvedAt:string; }
export interface CapacitySnapshotV1 { leaseRef:string; runtimeBindingRef:string; accountRef?:string; sessionRef?:string; profileRef?:string; acquiredAt:string; expiresAt:string; eligibilityOutcome:'eligible'; requirementDigest:string; }
export interface AutoHubRunV1 { runRef:string; status:'running'|'succeeded'|'failed'|'cancelled'|'unknown'; safeOutputRef?:string; safeErrorCode?:string; }
export interface OutputAuthorizationV1 { authorizationRef:string; uploadRef:string; expiresAt:string; }
export interface StorageResultV1 { resourceId:string; resourceVersionId:string; storageIdentity:string; checksumSha256:string; mimeType:string; sizeBytes:number; width?:number; height?:number; durationSeconds?:number; }
export interface ReadGrantV1 { readGrantRef:string; expiresAt:string; }
export interface OwnerDeliveryReceiptV1 { deliveryRef:string; accepted:boolean; }
export type FixtureScenario='success'|'route-not-found'|'route-deactivated'|'invalid-parameters'|'no-capacity'|'login-required'|'account-attention'|'provider-rejected'|'timeout'|'malformed-output'|'storage-failure'|'callback-failure'|'unknown-run';
export interface ResolveRouteV1 { operation:OperationType; routeLocks:Record<string,string>; fixtureScenario?:FixtureScenario; }
export interface AcquireCapacityV1 { route:RouteSnapshotV1; fixtureScenario?:FixtureScenario; }
export interface RenewCapacityV1 { leaseRef:string; fixtureScenario?:FixtureScenario; }
export interface ReleaseCapacityV1 { leaseRef:string; }
export interface ReportCapacityOutcomeV1 { leaseRef:string; outcome:string; }
export interface StartRunV1 { operation:OperationType; adapterId:string; runtimeBindingRef:string; fixtureScenario?:FixtureScenario; }
export interface GetRunV1 { runRef:string; fixtureScenario?:FixtureScenario; }
export interface CancelRunV1 { runRef:string; }
export interface CreateOutputAuthorizationV1 { executionId:string; attemptId:string; mode:'post-run-ingest'|'direct-write'; artifactKind:'image'|'video'; acceptedMimeTypes:readonly string[]; storageProfileRef?:string; maxBytes?:number; mimeType:string; fixtureScenario?:FixtureScenario; }
export interface CompleteOutputV1 { authorizationRef:string; safeProviderOutputRef:string; mimeType:string; fixtureScenario?:FixtureScenario; }
export interface CreateReadGrantV1 { resourceId:string; }
export interface OwnerDeliveryV1 { executionId:string; result:unknown; fixtureScenario?:FixtureScenario; }
