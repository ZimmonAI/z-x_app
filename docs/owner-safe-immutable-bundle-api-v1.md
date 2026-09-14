# Owner-Safe Immutable Bundle Execution API v1

Status: caller contract and fixture activation path are published on the **existing** execution API. Production generalized immutable-bundle persistence/ordered-step runtime binding is not yet available, so `zx.bundle-owner.v1` submit currently fails closed with `503 service unavailable` unless an explicit bundle runtime service is injected. Legacy execution contracts continue through the same routes.

This API is generic. An owning application freezes its business action, selects one exact immutable published Z-X bundle version, and supplies only manifest-keyed inputs plus bounded owner-approved references/capabilities. The caller never selects provider account, profile, runtime node, worker, internal step, attempt number, provider-private route, or retry policy.

## Authentication and scopes

All routes require `Authorization: Bearer <app-token>`. The existing JWT verifier supplies the authenticated `owner_app`.

- submit: `zx.executions.submit`
- read execution: `zx.executions.read`
- cancel execution: `zx.executions.cancel`
- retrieve final temporary artifact: `zx.executions.read`

Owner isolation is enforced at the service boundary. A caller cannot discover another owner's execution or artifact; cross-owner reads return `404`.

## Submit an immutable bundle execution

`POST /internal/v1/executions`

Successor request contract: `zx.bundle-owner.v1` (`src/contracts/v1/bundle-owner.ts`). The older `zx.execution.v1` contract remains supported on the same route.

```json
{
  "contractVersion": "zx.bundle-owner.v1",
  "ownerApp": "video-maker",
  "ownerActionId": "scene-video-generation:42",
  "ownerProjectId": "video-project:7",
  "idempotencyKey": "owner-scoped-idempotency-key",
  "requestFingerprint": "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
  "bundleVersionId": "exact-published-bundle-version-id",
  "manifestInputs": {
    "prompt": [
      { "kind": "value", "value": "example text" }
    ],
    "beginningFrame": [
      {
        "kind": "artifact",
        "artifactRef": "owner-artifact:begin",
        "capabilityRef": "grant:begin",
        "mimeType": "image/png",
        "sizeBytes": 12345,
        "checksumSha256": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
      }
    ]
  },
  "correlation": {
    "sceneId": "scene-42"
  },
  "traceId": "trace-scene-42"
}
```

The request is strict. Unknown top-level controls are rejected. In particular, the caller cannot supply provider/model/account/profile/runtime/worker/step/attempt/retry/route-lock authority. `ownerApp` must match the authenticated owner identity.

Before acceptance, Z-X resolves the exact `bundleVersionId`, requires it to be published and executable, validates every supplied `manifestInputs` key against the bundle's declared input usages, and enforces manifest type/cardinality. Activation freezes the exact bundle version, linked manifest versions, script versions, runtime packages, input/output bindings, step policies, final-output bindings, supplied manifest inputs, and ordered execution-local step instances. The outer step-control contract is exactly `DONE / POLLING / FAILED`.

Response status:

- `202 Accepted`: a new execution was accepted.
- `200 OK`: the same authenticated owner replayed the same idempotency key with the same request fingerprint and receives the same execution identity.
- `409 Conflict`: the same authenticated owner reused the idempotency key with a different fingerprint.

Idempotency is scoped by authenticated owner application.

Example accepted response:

```json
{
  "contractVersion": "zx.bundle-owner.v1",
  "executionId": "4e8b53fc-0f97-4a45-aec6-c19f41586d23",
  "status": "accepted",
  "outputs": [],
  "createdAt": "2026-09-14T08:00:00.000Z",
  "updatedAt": "2026-09-14T08:00:00.000Z"
}
```

## Read owner-scoped execution truth

`GET /internal/v1/executions/:executionId`

Normalized bundle-owner statuses are:

- `accepted`
- `queued`
- `running`
- `succeeded`
- `failed`
- `cancelled`
- `timed-out`

The `zx.bundle-owner.v1` response exposes only:

```text
contractVersion
executionId
status
outputs[]
failure? { code, message }
createdAt
updatedAt
terminalAt?
```

It does not expose request fingerprints, idempotency keys, internal step/attempt tables, provider/account/profile/runtime identity, leases, runtime filesystem paths, credentials, cookies/tokens, or unrestricted provider URLs.

A final scalar/object output is keyed by the bundle's declared output usage:

```json
{
  "usageKey": "generationReport",
  "ordinal": 0,
  "value": { "status": "succeeded" }
}
```

A file-backed final output contains a bounded temporary-artifact reference:

```json
{
  "usageKey": "generatedVideo",
  "ordinal": 0,
  "artifact": {
    "artifactId": "opaque-artifact-id",
    "mimeType": "video/mp4",
    "sizeBytes": 1234567,
    "checksumSha256": "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    "expiresAt": "2026-09-14T09:00:00.000Z",
    "retrievalPath": "/internal/v1/executions/4e8b53fc-0f97-4a45-aec6-c19f41586d23/artifacts/opaque-artifact-id"
  }
}
```

Repeated terminal reads return stable normalized owner truth and do not create new provider work.

## Cancel

`POST /internal/v1/executions/:executionId/cancel`

The existing authenticated owner-scoped cancellation route is reused. Bundle executions return the same normalized `zx.bundle-owner.v1` execution shape. Retry and reconcile remain legacy/runtime-controlled compatibility surfaces; the immutable-bundle caller does not choose attempt number or routing controls.

## Retrieve a final temporary artifact

`GET /internal/v1/executions/:executionId/artifacts/:artifactId`

Before returning bytes the service verifies:

1. the authenticated owner can see the execution;
2. the execution is terminal `succeeded`;
3. the requested artifact is referenced by a final output visible on that execution;
4. the artifact record belongs to the same owner and execution;
5. the artifact has not expired;
6. declared and actual byte size match and remain inside the bounded artifact policy;
7. MIME/checksum metadata conforms to the safe contract.

Success streams bytes with safe metadata:

- `Content-Type`
- `Content-Length`
- `X-ZX-Checksum-Sha256` when available
- `X-ZX-Artifact-Expires-At`

Z-X temporary artifacts are handoff storage only. Durable business storage remains owned by the calling application.

## Error/status mapping

- `400`: malformed contract, undeclared manifest key, manifest cardinality/type violation.
- `401`: missing/invalid bearer authentication.
- `403`: required scope missing or request `ownerApp` does not match the authenticated owner.
- `404`: exact published bundle not found, or execution/artifact is not visible to the authenticated owner.
- `409`: owner-scoped idempotency conflict, non-executable catalog graph, or bounded artifact integrity violation.
- `410`: temporary artifact expired.
- `429`: execution/artifact rate limit exceeded.
- `503`: generalized immutable-bundle production activation/runtime binding is unavailable.

## Compatibility and implementation boundary

`zx.bundle-owner.v1` is the canonical immutable-bundle successor contract, but it uses the existing `/internal/v1/executions` API and existing auth/scope/rate-limit boundary. `zx.execution.v1` and the older Video Maker compatibility contracts are not silently changed.

The source currently publishes the strict request/response contract, same-route dispatch adapter, owner-scoped idempotency, exact-bundle/catalog/manifest validation, execution-local activation freeze, normalized owner-safe outputs/failures, cancellation dispatch, and bounded temporary-artifact authorization/retrieval. Automated contract tests require no live provider call.

The production server still binds immutable-bundle execution to `UnavailableBundleOwnerExecutionService` until generalized durable activation/persistence and ordered-step runtime work is implemented. This contract is sufficient for an owner-side transport client to target the final field names and routes, but real provider Scene Video acceptance remains blocked on that runtime work.
