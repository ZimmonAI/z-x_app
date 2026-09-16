# Delegated Z-s output handoff and recovery

Z-X hands generated media to Z-s only through owner-authorized write authority. Z-X does not select, discover, infer, or substitute a Storage Service or provider destination. The owning app creates the exact Z-s write intent and bounded delegated upload authority before execution; Z-X receives only the public write-intent identity and bounded capability needed for that execution.

## Normal handoff

```text
provider/script succeeds
-> Z-X records the external run identity
-> controlled runtime captures the produced bytes as an owner-scoped bounded temporary artifact
-> Z-X records the temporary artifact identity and exact owner-authorized Z-s write-intent identity
-> Z-X PUTs the same bytes to /v1/object-write-intents/{writeIntentId}/content
   using Z-X service authentication + the delegated upload-completion capability
-> Z-s validates caller, write intent, target authority, MIME, byte length and checksum
-> Z-s stores/verifies the object and runs its configured relationship work
-> Z-X returns owner correlation + safe Z-s storageObjectId and verified technical metadata
```

The temporary artifact is staging/recovery evidence, not durable business storage and not destination authority. Z-s remains the owner of provider routing, placement, verification, protection and relationship execution.

## Recovery after generation succeeded

Generation success and durable Z-s acceptance are separate facts. Z-X persists them separately:

- `external_run_ref` proves the provider/script run produced a result reference.
- `safe_provider_output_ref` is repurposed on this path to hold the bounded Z-X temporary-artifact reference after capture.
- `output_authorization_ref` holds only the public exact Z-s write-intent identity; the delegated capability remains frozen in the immutable execution request and is not copied into attempt/result metadata.

When Z-s handoff fails retryably after capture, the execution moves to `reconciliation-required`. Storage reconciliation reopens the same temporary artifact under the same owner/project/execution/attempt scope and retries only the exact Z-s write. It does not resolve a new provider route, reacquire provider capacity, restart the provider/script, rematerialize the provider output, select another write intent, or widen authority.

If the temporary artifact is expired/unavailable or the bounded owner authority is terminally rejected, reconciliation records a truthful storage-output failure rather than rerunning expensive generation silently.

## Temporary artifact invariants

The `TemporaryArtifactClient` contract is backend-neutral. A runtime implementation must preserve:

- owner-app, optional owner-project, execution and attempt scope on retrieval;
- MIME and maximum-byte bounds from the frozen execution contract;
- immutable checksum and byte-length evidence;
- bounded expiry and explicit cleanup;
- retrieval independent of the original caller connection;
- no provider credentials, private endpoints, bucket/prefix/object-key values, or owner long-lived bearer in artifact metadata.

`InMemoryTemporaryArtifactStore` is the deterministic/reference implementation used by tests and injected runtimes. Production deployments may use an approved local/shared temporary backend without changing the execution contract.

## Z-s boundary

Delegated output uses the existing generic Z-s write data plane:

```text
Authorization: Bearer <Z-X service credential>
x-zs-upload-completion-token: <bounded owner-issued delegated capability>
PUT /v1/object-write-intents/{exactWriteIntentId}/content
```

Z-X sends the captured MIME, exact byte length and SHA-256 checksum and accepts success only when Z-s returns the same write-intent identity plus matching verified byte/checksum evidence and a safe `storageObjectId`. Provider-private response fields are rejected.

No database migration is required for this task. Existing attempt evidence and reconciliation-case persistence are sufficient, while the bounded capability itself stays in the immutable execution request introduced by the delegated-authority transport task.
