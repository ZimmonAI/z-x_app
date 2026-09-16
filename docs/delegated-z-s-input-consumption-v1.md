# Delegated Z-s exact-object input consumption

Z-X consumes owner-selected Z-s input objects through the existing governed exact-object read route. This is a generic execution capability; it is not enabled by Video Maker identity or by any provider-specific condition.

## Runtime boundary

The owner freezes the exact `storageObjectId` in its execution/script contract and supplies the bounded Z-s read authority through the generic `delegatedAuthorities` plane. Execution code names the authority it requires and calls `consumeDelegatedExactObject(...)` with that exact object identity.

Z-X then performs:

```text
Z-X service authentication
+ delegated exact-object read authority
+ exact owner-selected storageObjectId
-> GET /v1/storage-objects/{storageObjectId}/content
-> Z-s validates caller + authority + object identity
-> Z-s chooses only an eligible physical copy of that same logical object
-> Z-X returns verified MIME/length/checksum metadata plus the bounded response stream
-> script consumes the stream
```

The delegated read authority is sent only in `x-zs-read-grant-token`. Z-X's configured server-side integration bearer remains the `Authorization` credential. The owner's long-lived integration bearer is never accepted or required by this path.

## Invariants

- Z-X never asks for a provider endpoint, bucket, prefix, object key, signed provider URL, or provider credential.
- Z-X does not enumerate related/original/derivative/sibling objects and has no fallback-object selection branch.
- `404`, terminal unavailability, or authority rejection fail the exact input truthfully; they do not trigger substitution.
- Z-s may fail over among governed physical copies only because those copies belong to the same `storageObjectId`.
- Provider/private `Location` or `Content-Location` response headers are rejected rather than followed or exposed.
- The Z-s response must include a strong checksum ETag, MIME type, and positive byte length. Stream consumption enforces the declared byte length.
- Delegated authority material is not copied into result envelopes, safe errors, correlation strings, or provider-facing metadata.
- Existing fixture output behavior and legacy `ownerStorageAccess` compatibility are unchanged.

## Failure semantics

Exact input failures use the generic `storage-input-failure` safe-error family. Not-found and terminal-unavailable results are non-retryable; not-ready and dependency failures may be retryable against the same exact object and authority. Retry never widens the object identity.

No database migration is required. The exact object identity remains caller/script data and the delegated authority is already frozen by the generic execution request envelope introduced by the delegated-authority transport task.
