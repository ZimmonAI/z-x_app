# Owner-Safe Immutable Bundle Execution API v1

Status: contract and fixture activation path published; production generalized immutable-bundle runtime binding is not yet available. The default production binding returns `503 service unavailable` until the ordered-step runtime/persistence handoff is implemented and proven.

This API is generic. An owning application selects one exact immutable published bundle version and supplies only manifest-keyed inputs. The caller never selects provider, raw model, account, profile, runtime node, internal step, attempt count, retry interval, or placement.

## Authentication and scopes

All routes require `Authorization: Bearer <app-token>`. The existing JWT verifier supplies the authenticated `owner_app`; the browser/client must never receive or forward another application's bearer credentials.

- submit: `zx.executions.submit`
- read execution: `zx.executions.read`
- retrieve final temporary artifact: `zx.executions.read`

Owner isolation is applied before execution/result visibility. A caller cannot discover another owner's execution or artifact; cross-owner reads return `404`.

Cancellation is intentionally **not exposed** in this API version while the generalized immutable-bundle runtime is unavailable. It may be added only when cancellation can be honored truthfully against execution identity.

## Submit an immutable bundle execution

`POST /internal/v1/bundle-executions`

Request contract: `zx.bundle-owner.v1` (`src/contracts/v1/bundle-owner.ts`).

```json
{
  "contractVersion": "zx.bundle-owner.v1",
  "ownerType": "app",
  "ownerRef": "opaque-owner-business-action",
  "bundleVersionId": "exact-published-bundle-version-id",
  "idempotencyKey": "owner-scoped-idempotency-key",
  "requestFingerprint": "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
  "inputs": {
    "prompt": [
      { "kind": "value", "value": "example text" }
    ],
    "beginningFrame": [
      {
        "kind": "artifact",
        "artifactRef": "opaque-owner-artifact-ref",
        "mimeType": "image/png",
        "sizeBytes": 12345,
        "checksumSha256": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
      }
    ]
  },
  "correlation": {
    "sceneId": "scene-42"
  }
}
```

The request is strict. Unknown top-level controls are rejected, including provider/model/account/profile/runtime/step/attempt/retry controls.

Before acceptance, Z-X must resolve the exact `bundleVersionId`, require it to be published, validate its catalog graph, require linked script versions and runtime packages to be executable, validate every supplied input key against declared bundle input usages, and enforce each manifest usage's cardinality and value kind. The activation boundary freezes the exact bundle, linked manifest/script versions, bindings, policies, and supplied inputs; it must never reinterpret the business request into another bundle.

Response status:

- `202 Accepted`: a new execution was accepted.
- `200 OK`: the same authenticated owner replayed the same idempotency key with the same request fingerprint; the previously accepted execution identity is returned.
- `409 Conflict`: the same authenticated owner reused the idempotency key with a different fingerprint.

Idempotency is scoped by authenticated owner application. The same key used by another owner is independent.

Example accepted response:

```json
{
  "contractVersion": "zx.bundle-owner.v1",
  "executionId": "4e8b53fc-0f97-4a45-aec6-c19f41586d23",
  "state": "accepted",
  "outputs": [],
  "createdAt": "2026-09-14T08:00:00.000Z",
  "updatedAt": "2026-09-14T08:00:00.000Z"
}
```

## Read owner-scoped execution truth

`GET /internal/v1/bundle-executions/:executionId`

Normalized owner-visible states are:

- `accepted`: accepted and frozen for execution;
- `queued`: eligible/waiting for generalized runtime work;
- `running`: bundle work is executing;
- `succeeded`: terminal success; final output items are stable;
- `failed`: terminal failure; `failure` contains only safe normalized code/message;
- `cancelled`: terminal cancellation, if future runtime cancellation support is added;
- `timed-out`: terminal timeout.

The response exposes only:

```text
contractVersion
executionId
state
outputs[]
failure? { code, message }
createdAt
updatedAt
terminalAt?
```

It does not expose provider/account/profile/runtime binding, current internal step IDs, attempt rows, leases, runtime filesystem paths, credentials, cookies/tokens, or private provider URLs.

A final output item is keyed by the bundle's declared output usage:

```json
{
  "usageKey": "generationReport",
  "ordinal": 0,
  "value": { "status": "succeeded" }
}
```

A file-backed final output contains a bounded temporary artifact reference instead of an internal path or provider URL:

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
    "retrievalPath": "/internal/v1/bundle-executions/4e8b53fc-0f97-4a45-aec6-c19f41586d23/artifacts/opaque-artifact-id"
  }
}
```

Repeated terminal reads return the same normalized execution/output identity and do not themselves create provider work.

## Retrieve a final temporary artifact

`GET /internal/v1/bundle-executions/:executionId/artifacts/:artifactId`

The service must verify all of the following before returning bytes:

1. the authenticated owner can see the execution;
2. the execution is terminal `succeeded`;
3. the requested artifact is referenced by a final output visible on that execution;
4. the artifact record belongs to the same owner and execution;
5. the artifact has not expired.

Success streams the artifact bytes with safe metadata:

- `Content-Type`
- `Content-Length`
- `X-ZX-Checksum-Sha256` when available
- `X-ZX-Artifact-Expires-At`

The response never exposes `runtime_node_ref`, local/runtime filesystem location, browser/profile path, credential/token/cookie material, or unrestricted provider download URLs. Z-X temporary artifacts are technical handback only; durable owner storage remains outside Z-X.

## Error/status mapping

- `400`: malformed contract, undeclared input key, manifest cardinality/type violation.
- `401`: missing/invalid bearer authentication.
- `403`: required scope missing.
- `404`: exact published bundle not found, execution/artifact not visible to the authenticated owner, or artifact unrelated to visible final output. Cross-owner resources use `404` for non-disclosure.
- `409`: owner-scoped idempotency conflict or catalog graph is not executable.
- `410`: temporary artifact expired.
- `429`: server request-rate limit exceeded where configured.
- `503`: generalized immutable-bundle activation/runtime/persistence binding is not available in the running deployment.

## Current implementation boundary

The source tree publishes the strict caller/response contract, authenticated routes, fixture activation service, exact-bundle/catalog/input validation, owner-scoped idempotency, normalized output/failure shape, redaction boundary, and bounded artifact authorization/retrieval behavior.

The production server intentionally binds these routes to `UnavailableBundleOwnerExecutionService` until the generalized immutable-bundle persistence and ordered-step worker from the runtime handoff are implemented and tested. Therefore this contract publication alone does **not** claim live bundle execution readiness and does **not** unblock Video Maker Task 03.

Legacy `zx.execution.v1` routes remain unchanged and compatible while this narrow bundle-owner API is introduced separately.
