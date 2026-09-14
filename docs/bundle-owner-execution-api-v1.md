# Owner-safe immutable bundle API v1

## Status

This document freezes the first owner-facing API contract for exact immutable bundle execution.

The HTTP surface and fixture-backed generalized activation service are implemented and tested. The production default deliberately returns `503 service unavailable` until the generalized ordered-step runtime from the Leonardo runtime task is implemented, persisted, and explicitly authorized. The API MUST NOT fall back to `zx.execution.v1`, route locks, or the legacy Video Maker phase engine.

## Contract

Package export:

```text
@zimspace/z-x-execution-runner/contracts/bundle-owner/v1
```

Contract version:

```text
zx.bundle-owner.execution.v1
```

Source:

```text
src/contracts/bundle-owner/v1/execution.ts
```

The authenticated JWT `owner_app` claim is the owner application identity. The request body has no `ownerApp` field and cannot select another owner.

## Submit exact published bundle

```http
POST /internal/v1/bundle-executions
Scope: zx.bundle-executions.submit
```

Request body:

```json
{
  "ownerType": "app",
  "ownerRef": "opaque-owner-business-action-ref",
  "bundleVersionId": "exact-published-bundle-version-id",
  "idempotencyKey": "owner-scoped-idempotency-key",
  "requestFingerprint": "64-lowercase-hex-sha256",
  "inputs": {
    "prompt-text": [
      { "kind": "value", "value": "prompt" }
    ],
    "beginning-frame-image": [
      {
        "kind": "resource",
        "resourceRef": "opaque-owner-resource-ref",
        "mimeType": "image/png"
      }
    ]
  },
  "correlation": {
    "businessKey": "safe-opaque-correlation"
  }
}
```

`inputs` is keyed by the stable manifest definition `manifestKey`, not by step ID, script ID, provider field, runtime field, or caller-selected route. Z-X resolves each manifest key through the exact `bundleVersionId`, validates declared cardinality and value/resource type, and freezes the exact published bundle graph.

The following caller controls are intentionally absent and rejected by strict schema validation:

```text
provider
model
account/profile
runtime node
step ID
attempt count
retry interval
lease
script version override
manifest version override
```

### Request fingerprint

The server verifies the caller-supplied fingerprint. Fingerprint material is exactly:

```text
ownerType
ownerRef
bundleVersionId
inputs
correlation
```

`idempotencyKey` and `requestFingerprint` are excluded from the fingerprint material. The material is normalized as JSON with recursively sorted object keys while array order is preserved, UTF-8 encoded, and SHA-256 hashed to lowercase hex. The package exports `computeBundleExecutionRequestFingerprint()` so owning server applications can use the same canonical implementation.

### Activation rules

Before allocating an execution ID, Z-X requires:

1. exact `bundleVersionId` exists;
2. bundle version is `published`;
3. bundle catalog validation passes;
4. every linked script version/package satisfies the published executable gate;
5. runtime-affinity definitions are structurally valid;
6. every submitted manifest key belongs to the bundle input contract;
7. every required input satisfies declared cardinality;
8. every item matches the declared manifest `valueKind`.

A fixture/generalized activation freezes a private snapshot of the selected bundle, linked script versions, manifest versions, runtime packages, step bindings, policies, and runtime-affinity definitions. None of those orchestration internals are exposed by the owner read contract.

### Idempotency

Idempotency is scoped by authenticated owner application plus `idempotencyKey`.

```text
first valid request -> 202 + stable executionId
same owner + same key + same verified fingerprint -> 200 + same execution
same owner + same key + different verified fingerprint -> 409 ZX_IDEMPOTENCY_CONFLICT
different owner + same key -> independent namespace
```

## Read normalized execution

```http
GET /internal/v1/bundle-executions/{executionId}
Scope: zx.bundle-executions.read
```

Owner-visible shape:

```json
{
  "contractVersion": "zx.bundle-owner.execution.v1",
  "executionId": "opaque-execution-id",
  "bundleVersionId": "exact-published-bundle-version-id",
  "ownerRef": "opaque-owner-business-action-ref",
  "state": "accepted|queued|running|succeeded|failed|cancelled",
  "outputs": [
    {
      "manifestKey": "generated-video",
      "usageKey": "generatedVideo",
      "items": []
    }
  ],
  "failure": {
    "code": "safe-terminal-code",
    "message": "safe-terminal-message"
  },
  "createdAt": "ISO-8601",
  "updatedAt": "ISO-8601",
  "terminalAt": "ISO-8601"
}
```

`failure` and `terminalAt` are present only when applicable. Repeated terminal reads return the same normalized execution/output identities and MUST NOT dispatch provider work.

The owner response does not contain:

```text
current step ID
step instance ID
script attempt ID/count
lease data
provider/model/account/profile
runtime node/session/binding
local filesystem path
provider download URL
credential/cookie/token
private runtime URL
```

Unknown execution IDs and cross-owner reads both return `404 not found` so the route does not disclose existence across owners.

## Temporary artifact retrieval

A final output item representing a file is returned as:

```json
{
  "kind": "temporary-artifact",
  "artifact": {
    "artifactRef": "opaque-artifact-ref",
    "mimeType": "video/mp4",
    "sizeBytes": 123,
    "checksumSha256": "optional-64-lowercase-hex",
    "fileNameHint": "optional-safe-name",
    "expiresAt": "ISO-8601"
  }
}
```

Retrieve bytes through:

```http
GET /internal/v1/bundle-executions/{executionId}/artifacts/{artifactRef}
Scope: zx.bundle-executions.artifacts.read
```

Before returning bytes, the service verifies all of:

```text
authenticated owner owns execution
artifact owner is same owner
artifact belongs to requested execution
artifact remains available and unexpired
```

Cross-owner and unrelated execution/artifact combinations return `404`. Expired artifacts return `410 ZX_ARTIFACT_EXPIRED`. A successful response streams bytes and includes safe `Content-Type`, `Content-Length`, `X-ZX-Artifact-Ref`, and checksum metadata when available. It never returns runtime-node placement, an internal path, credentials, or provider download URLs.

## Cancellation

Cancellation is intentionally **not published** in this API version yet. There is no `/cancel` route for bundle executions. It may be added only when the generalized ordered-step runtime can persist and enforce cancellation truthfully.

## Error mapping

| HTTP | Error | Meaning |
|---|---|---|
| 400 | schema/Zod failure | malformed or forbidden request field |
| 400 | `ZX_REQUEST_FINGERPRINT_MISMATCH` | supplied fingerprint does not match canonical request material |
| 400 | `ZX_BUNDLE_INPUT_UNKNOWN` | submitted manifest key is not a bundle input |
| 400 | `ZX_BUNDLE_INPUT_CARDINALITY` | input count violates declared usage |
| 400 | `ZX_BUNDLE_INPUT_TYPE_MISMATCH` | item does not match manifest value kind |
| 401 | `unauthorized` | bearer authentication failed |
| 403 | `forbidden` | required scope missing |
| 404 | `ZX_BUNDLE_NOT_FOUND` | exact bundle version does not exist at submit time |
| 404 | `not found` | execution/artifact absent or not owned by caller |
| 409 | `ZX_IDEMPOTENCY_CONFLICT` | same owner/key but different request fingerprint |
| 410 | `ZX_ARTIFACT_EXPIRED` | bounded temporary artifact expired |
| 422 | `ZX_BUNDLE_NOT_PUBLISHED` | requested bundle exists but is not published |
| 422 | `ZX_BUNDLE_NOT_EXECUTABLE` | published graph fails executable/catalog validation |
| 422 | `ZX_BUNDLE_INPUT_AMBIGUOUS` | catalog would expose duplicate manifest input keys |
| 422 | `ZX_BUNDLE_MANIFEST_VALUE_KIND_UNSUPPORTED` | current owner contract cannot safely validate that manifest kind |
| 503 | `service unavailable` | production generalized immutable-bundle runtime is not wired/authorized |

Server errors at `5xx` remain safely normalized; internal exception details are not returned.

## Compatibility and runtime boundary

`POST /internal/v1/executions` and the existing `zx.execution.v1` / `zx.video-maker.execution.v1` compatibility paths remain unchanged. The owner-safe bundle API is a separate route and contract and does not translate its request into legacy `routeLocks`.

Current production readiness is intentionally blocked. The next runtime task must replace `UnavailableBundleOwnerExecutionService` with the real persistent generalized activation/ordered-step/artifact service, then prove the same contract against that implementation before any owning app is told the path is ready for production use.
