# Leonardo catalog registration foundation

This change prepares Task 01 source work that does not depend on the authoritative live migration SQL or the final Leonardo registration payload.

## Implemented

- provider-neutral catalog contracts for reusable manifests, immutable script versions and runtime packages, ordered bundle versions, normalized bindings, final outputs, and explicit step policy;
- draft bundle validation for references, cardinality, contiguous step order, one linked script version per step, required inputs, normalized prior-step-output bindings, final output bindings, and policy bounds;
- publication gates requiring every linked script version to be published and backed by a validated executable package with storage identity, checksum, and entrypoint;
- management service methods to create and read catalog records, validate drafts, publish through the gate, reject edits to published versions, and clone a published version into a new draft;
- tests proving exact input cardinality in the fixture, prior-step output binding, required report plus optional video output, two ordered steps, tag non-control, publication blocking, published immutability, and explicit duplicate rejection;
- a reviewed migration manifest and runner used by both package scripts and integration tests.

## Deliberately not claimed

The source does not yet contain:

- `migrations/0003_normalized_script_bundle_foundation_up.sql`;
- `migrations/0003_normalized_script_bundle_foundation_down.sql`;
- a PostgreSQL implementation of `CatalogRepository`;
- production Leonardo manifest, script, package, bundle, binding, or policy records;
- observed Leonardo generation-duration evidence;
- any executable Leonardo package, live database write, provider session, browser profile, or deployment action.

`0003-normalized-script-bundle-foundation` is reserved in `migrations/manifest.json` with `enabled: false`. The migration runner therefore continues to apply and roll back only `0001` and `0002` until the reviewed SQL is supplied.

## Completion sequence after the missing inputs arrive

1. Add the exact reviewed forward and rollback SQL as the reserved `0003` paths.
2. Add source-vs-live revision drift verification for `normalized-script-bundle-foundation-v1`.
3. Enable `0003` in the migration manifest and prove 56 tables, rollback to eight tables, and reapply.
4. Implement the PostgreSQL `CatalogRepository` against the frozen table and constraint names.
5. Add the approved Leonardo registration payload and an idempotent bootstrap command.
6. Add definition-specific tests for the six manifest versions, two script identities, exact two-step bundle, bindings, final outputs, and evidence-backed step policies.
7. Keep the bundle draft until Task 03 supplies validated real packages; publication must remain blocked before then.
