# Video Maker execution contract v1

## Decision

The Video Maker MVP uses the additive contract version `zx.video-maker.execution.v1`.

It does **not** widen or reinterpret `zx.execution.v1`. The four existing fixture operations remain accepted through their current schema and are documented as compatibility registrations. Persistence, worker phases, and API routing for the new contract are deliberately deferred to the next execution detail.

## Fixed envelope

Every accepted request has exactly these top-level fields. Unknown top-level fields fail strict validation.

| Field | Rule |
|---|---|
| `contractVersion` | Required literal `zx.video-maker.execution.v1`. |
| `ownerApp` | Required literal `video-maker_app`. |
| `ownerActionId` | Required opaque identifier, 1–256 characters. |
| `ownerProjectId` | Optional opaque identifier, 1–256 characters. |
| `idempotencyKey` | Required opaque identifier, 1–256 characters. |
| `requestFingerprint` | Required lowercase SHA-256 hex digest. It must match the canonical frozen semantics described below. |
| `traceId` | Required opaque identifier, 1–256 characters. |
| `toolKey` | Required `consumer-gpt` or `google-flow`. |
| `requestMode` | Required `initial` or `regenerate`. |
| `previousExecutionId` | Forbidden for `initial`; required UUID for `regenerate`. |
| `feedback` | Forbidden for `initial`; optional for `regenerate`; 1–4,096 characters and at most 8,192 UTF-8 bytes. |
| `frozenInputResources` | Required array, 0–16 strict opaque input references. Resource and storage-object IDs must be unique. |
| `ownerStorageAccess` | Required `zx.video-maker.owner-storage-access.v1` object with 1–4 unique output targets. |
| `requestedOutput` | Required strict technical output declaration. |
| `retryPolicy` | Strict object. Defaults: `maxAttempts=3`, `backoffSeconds=5`. Limits: 1–5 attempts and 1–300 seconds. |
| `timeoutPolicy` | Strict object. Defaults: `executionSeconds=900`, `phaseSeconds=300`. Limits: execution 30–3,600 seconds, phase 30–900 seconds, phase no longer than execution. |
| `priority` | Integer 0–9, default 5. |
| `correlation` | Up to 16 bounded safe key/value entries. |
| `toolParameters` | Strict schema selected by `toolKey`. Unknown fields fail validation. |

All accepted IDs and capability references are opaque. URL-like, path-like, credential-like, bucket-like, token-like, and signed-URL-like references fail validation.

## Frozen input resources

Each resource is strict and contains:

- `resourceId`: owner correlation ID;
- `storageObjectId`: opaque provider-neutral storage object reference;
- `readGrantRef`: opaque owner-issued read capability;
- `kind`: `image` or `text`;
- `mimeType`: bounded MIME type matching the declared kind;
- optional lowercase SHA-256 `checksumSha256`.

Every frozen input must appear exactly once in the tool-specific role list. The role list cannot reference an unfrozen resource. Array order is part of the frozen request semantics.

## Owner storage access and requested output

`ownerStorageAccess.contractVersion` is `zx.video-maker.owner-storage-access.v1`.

`ownerStorageAccess.outputTargets` contains one target per requested output:

- `pendingResourceId`: opaque owner correlation ID;
- `outputWriteGrantRef`: opaque owner-issued write capability.

Target count must equal `requestedOutput.count`. Target IDs and grant references must be unique.

`requestedOutput` contains:

- `kind`: `text`, `image`, or `video`;
- `mimeType`;
- `count`, bounded to 1–4;
- optional positive safe integer `maxBytesPerOutput`.

This contract does not accept storage credentials, provider names, bucket/prefix/object coordinates, local paths, unrestricted signed URLs, or Video Maker activation authority.

## Consumer GPT parameters

`toolKey=consumer-gpt` selects this strict shape:

- `prompt`: nonblank bounded safe text, at most 32,768 characters and 32,768 UTF-8 bytes;
- `inputResourceRoles`: 0–16 unique `{resourceId, role}` entries where role is `image` or `text` and matches the frozen resource kind;
- `outputKind`: `text` or `image`;
- `imageCount`: required only for image output, integer 1–4;
- `generationSettings`: strict optional settings with defaults to `{}`:
  - `temperature`: 0–2;
  - `seed`: integer 0–2,147,483,647;
  - `styleHint`: bounded safe text;
  - `aspectRatio`: `1:1`, `4:3`, `3:4`, `16:9`, or `9:16`;
  - `quality`: `standard` or `high`.

Text output requires exactly one `text/plain` output and rejects `imageCount`, `aspectRatio`, and `quality`.

Image output requires one of `image/png`, `image/jpeg`, or `image/webp`; `requestedOutput.count` must equal `imageCount`. One execution cannot request both text and image output.

## Google Flow parameters

`toolKey=google-flow` selects this strict shape:

- `prompt`: nonblank bounded safe text, at most 32,768 characters and 32,768 UTF-8 bytes;
- `imageResourceRoles`: 0–2 unique entries with role `start-image` or `end-image`;
- `generationSettings`: strict optional settings with defaults to `{}`:
  - `durationSeconds`: integer 1–30;
  - `aspectRatio`: `16:9`, `9:16`, or `1:1`;
  - `resolution`: `720p` or `1080p`;
  - `seed`: integer 0–2,147,483,647;
  - `motionGuidance`: bounded safe text;
- `requestedVideoMimeType`: `video/mp4` or `video/webm`.

Duplicate start/end roles, duplicate resource references, unsupported roles, non-image role resources, and unknown settings fail validation. The request must declare exactly one video output and its MIME type must match `requestedVideoMimeType`.

## Regeneration

An initial request rejects both `previousExecutionId` and `feedback`.

A regeneration request requires `previousExecutionId` and may include bounded `feedback`. This contract freezes the request representation only. Detail 02 must enforce same-owner prior-execution lookup, eligible prior terminal state, new-execution creation, prior truth immutability, and safe continuation-reference reuse.

## Fingerprint and canonicalization

The fingerprint covers the complete normalized accepted request semantics except the `requestFingerprint` field itself.

Canonicalization is deterministic JSON with these rules:

1. apply schema defaults and all strict validation first;
2. remove only the top-level `requestFingerprint` field;
3. sort every object’s keys lexicographically;
4. omit properties whose value is `undefined`;
5. preserve array order exactly;
6. serialize strings, booleans, finite numbers, and `null` using JSON encoding with no extra whitespace;
7. hash the UTF-8 canonical JSON bytes with SHA-256 and encode lowercase hexadecimal.

A syntactically valid fingerprint that does not match the normalized request fails with `ZX_VM_REQUEST_FINGERPRINT_MISMATCH`.

## Compatibility boundary

`zx.execution.v1` remains unchanged and continues to accept:

- `image_prompt.prepare.v1`;
- `image.generate.v1`;
- `scene_video_prompt.prepare.v1`;
- `scene_video.generate.v1`.

The new compatibility registration file relates those fixture operations to `consumer-gpt` or `google-flow` as legacy prompt-preparation/generated-output roles. It does not convert them into the permanent Z-X tool catalog and does not reinterpret existing persisted requests or results.

## Fields deliberately not accepted

The contract deliberately rejects provider selection, provider account IDs, browser/profile/session details, raw runner URLs, cookies, tokens, credentials, storage provider coordinates, callbacks, webhooks, Video Maker scene/business-resource payloads, final-resource activation instructions, arbitrary generation settings, arbitrary operation names, and unknown envelope fields.

## Exact source boundary for this detail

Changed source is limited to:

- `src/contracts/video-maker/v1/execution.ts`;
- `src/contracts/video-maker/v1/compatibility.ts`;
- `src/contracts/video-maker/v1/index.ts`;
- `src/validation/video-maker-request.ts`;
- `tests/contract/video-maker-execution-v1.test.ts`;
- `tests/contract/zx-execution-v1-compatibility.test.ts`;
- `docs/video-maker-execution-contract-v1.md`;
- `package.json` export metadata.

Not changed in this detail: API routes, persistence repositories, migrations, worker scheduling/lifecycle, adapters, fixtures, real clients, result contracts, or runtime configuration.

## Deferred to Detail 02

Detail 02 must add additive persistence and lifecycle support for the new contract version, including immutable request-envelope storage, tool key, request mode, prior-execution lineage, continuation reference, current phase, phase attempts, normalized failure/result, and API submit/read behavior. It must not revise this request shape without returning to the contract-lock task.
