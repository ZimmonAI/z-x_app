# Cross-App Acceptance Preparation Harness

Status: Phase A preparation complete for A1-A9. These tests validate the reusable acceptance boundary and acceptance assertions. Fake-driver success is **not** Phase B cross-app acceptance evidence and must not be used to mark 03-06 or its parent PASS.

Planning authority:

`z-kn/08-execution/z-s_app-mvp/tasks/planning/02t-client-directed-object-io-and-relationship-execution/03-06-cross-app-acceptance-and-canonical-sync.md`

## Accepted generic implementation beneath this harness

The generic delegated Z-s implementation is accepted on Z-X `main` through the merged 03-02/03-03/03-04 stack.

Current accepted source snapshot used while preparing this harness:

```text
Z-X main: 2e9dd7e67dd8fdc87daf1201d7e1b237c9d1cc53
03-02 PR #25: merged
03-03 PR #26: merged
03-04 PR #27: merged
```

The accepted 03-04 integration test already injects one retryable delegated Z-s handoff failure after production/materialization, persists the temporary-artifact evidence, retries only the Z-s handoff and proves provider start/get plus materialization remain at one call. This harness does not duplicate that production implementation; it adds the reusable acceptance assertions and safe evidence shape required by 03-06.

## Phase-A preparation completed

- A1 neutral-owner fixture with no Video Maker, Scene, Series or Resource business routing assumptions.
- A2 generic owner-safe driver surface for submit/read/cancel, exact-input observation and durable-output observation.
- A3 exact-input assertion that rejects sibling/original/derivative substitution.
- A4 exact-output assertion that rejects a different write intent or Storage Service instead of silently correcting it.
- A5 reusable leakage inspection for public/normalized evidence and configured raw secret values.
- A6 controlled storage-only failure probe contract requiring the exact retryable Z-s handoff failure after production.
- A7 same-artifact recovery assertion requiring one production/materialization, at least two durable handoff attempts, one execution/action/fingerprint and a safe artifact checksum/fingerprint.
- A8 accepted-submit/local-persist-failure reconciliation assertion requiring the retry to return the same Z-X execution, production count one and changed-fingerprint retry to fail closed.
- A9 safe evidence records containing only source identities and safe owner/execution/storage/artifact evidence.

A10 is a canonical-document reconciliation map owned by z-kn rather than this repository test harness.

## Recovery scope is explicit

The accepted reference temporary-artifact backend is in-memory. Therefore the harness can record `same-runtime` recovery when that backend is active, but it must not label the result restart-safe or production-durable.

A later runtime may record `restart-safe` only when the active temporary-artifact backend independently proves that durability property.

## No destination authority moves into Z-X

The neutral request deliberately does **not** send the selected Storage Service ID to generic Z-X execution logic. The fixture keeps that owner-selected ID as expected acceptance truth and compares it with safe durable-output evidence. The Z-X-facing request carries the exact write intent plus bounded opaque delegated authority.

No live endpoint, service identity, model, Tool Variant, credential or production object identity is hardcoded by this harness.

## What Phase A still does not prove

It does not prove:

- the current Video Maker Generate flow reaches Z-X;
- a real neutral-owner deployment executes through live Z-X and Z-s;
- the real owner maps durable Z-s output into Video Maker production-media lineage;
- restart-safe temporary-artifact recovery;
- production deployment or production acceptance.

Those are Phase B/runtime claims.

## Phase-B binding rule

When the real Video Maker 03-05 runtime handoff exists, bind `CrossAppAcceptanceDriver` to current public/canonical surfaces only:

```text
owner submit/read/cancel
-> generic Z-X owner-safe execution boundary

observeExactInput
-> exact logical Z-s object evidence

observeDurableOutput
-> safe Z-s result evidence for the exact owner-selected target

exerciseStorageOnlyRecovery
-> controlled existing Z-X storage-handoff fault policy/test adapter

exerciseAcceptedSubmitPersistFailure
-> owner orchestration failure point after Z-X accepts but before local correlation commit
```

Do not bind the harness to Z-X internal database tables, Z-s provider credentials, buckets, object keys, private locators, owner long-lived bearers or copied production secrets.
