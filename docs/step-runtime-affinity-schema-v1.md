# Step Runtime Affinity Schema v1

## Purpose

A bundle may need a later step to use the same provider account used by an earlier successful step without keeping a browser/profile session alive between invocations.

Leonardo image-to-video is the first required case:

- Submit may use any eligible Leonardo account on each attempt.
- A failed Submit attempt releases its profile/session before the attempt closes. A retry may use a different account.
- A successful Submit attempt records the stable account affinity used for the accepted generation, emits the generation-session continuation value, and releases its profile/session before returning `DONE`.
- Completion Check receives the generation-session continuation value and must reacquire the exact account affinity used by the successful Submit attempt.
- Every Completion Check attempt uses a fresh short-lived runtime/profile binding and releases it before returning `DONE`, `POLLING`, or `FAILED`.

Z-X must persist affinity, not browser liveness.

## Two independent relationships

### Continuation data

Existing normalized output/input routing carries the provider generation continuation value:

```text
Submit generationSession output
  -> execution_step_output_items / execution_values
  -> bundle_step_input_from_step_output
  -> Completion Check generationSession input
```

The continuation value does not select the provider account by itself.

If a provider session URL contains credentials, signed authorization parameters, cookies, or other secrets, the execution value must hold only a protected opaque reference (for example a Z-s storage object reference) rather than persisting the secret URL in clear text.

### Runtime affinity

A separate relationship declares and materializes the same-account requirement:

```text
bundle Step 2 requires ACCOUNT affinity from bundle Step 1
  -> successful Step 1 DONE attempt records an opaque affinity_ref
  -> execution-local affinity binds Step 2 to that source DONE attempt
  -> every Step 2 attempt asks the allocator for that affinity_ref
```

The affinity reference must be owner-issued and safe to persist. It must not be a cookie, password, browser-profile filesystem path, token, or live session identifier.

## Proposed migration

Reserve source migration:

```text
migrations/0004_step_runtime_affinity_up.sql
migrations/0004_step_runtime_affinity_down.sql
revision: step-runtime-affinity-v1
```

`0004` remains disabled until `0003` source synchronization is complete and the exact live-reviewed SQL is approved.

## Definition table

### `execution.execution_bundle_step_runtime_affinity_bindings`

One row declares that a target bundle step must reuse a stable runtime affinity from an earlier step.

Representative fields:

| Column | Meaning |
|---|---|
| `id` | stable relationship id |
| `bundle_step_id` | target bundle step |
| `source_bundle_step_id` | earlier step whose successful attempt supplies the affinity |
| `affinity_scope` | v1 value: `ACCOUNT` |
| `is_required` | target step cannot execute without the affinity when true |
| `created_at` | audit timestamp |

Constraints:

- source and target steps belong to the same bundle version;
- source `step_order` is lower than target `step_order`;
- at most one binding per target step and affinity scope;
- v1 supports `ACCOUNT` only.

For Leonardo:

```text
completion-check ACCOUNT affinity <- submit
```

Submit has no account-affinity requirement because each Submit attempt may select any eligible account.

## Execution-local affinity table

### `execution.execution_step_runtime_affinities`

One row materializes the affinity for an execution after the source step reaches `DONE`.

Representative fields:

| Column | Meaning |
|---|---|
| `id` | execution-local affinity id |
| `execution_id` | owning execution |
| `target_step_instance_id` | step that must reuse the affinity |
| `source_step_instance_id` | source step instance |
| `source_step_attempt_id` | exact accepted `DONE` attempt that supplied the affinity |
| `affinity_scope` | `ACCOUNT` |
| `affinity_ref` | opaque stable owner-issued affinity reference |
| `bound_at` | materialization timestamp |

Constraints:

- source and target step instances belong to the same execution;
- `source_step_attempt_id` belongs to the source step instance;
- source attempt must be the accepted `DONE` attempt used to advance the bundle;
- exactly one materialized affinity exists for a target step instance and scope.

This row survives release of the source browser/profile session.

## Attempt columns

Extend `execution.execution_step_attempts` with safe runtime lifecycle references:

| Column | Meaning |
|---|---|
| `runtime_affinity_ref` | stable affinity requested/used by this invocation, nullable when unrestricted |
| `runtime_binding_ref` | opaque short-lived allocator/runtime binding for this invocation |
| `runtime_acquired_at` | binding acquisition timestamp |
| `runtime_released_at` | binding release timestamp |

These fields provide audit evidence that account affinity and live runtime binding are separate concepts.

A successful or failed script invocation must not require the `runtime_binding_ref` to stay live after the attempt closes.

## Leonardo runtime route

### Submit attempt

```text
create attempt N
  -> request any eligible Leonardo account/profile
  -> receive runtime_binding_ref + stable account affinity_ref
  -> open Leonardo
  -> fill prompt + beginning frame + ending frame
  -> submit
  -> verify processing state
  -> always release runtime_binding_ref
```

If processing is definitively not confirmed:

```text
return FAILED (retryable while attempt budget remains)
  -> wait 5 seconds
  -> next Submit attempt may use a different account/profile
```

If processing is confirmed:

```text
persist generationSession output
persist affinity_ref on successful attempt
materialize Completion Check ACCOUNT affinity from this DONE attempt
release runtime binding
return DONE
```

If the submit action has an uncertain outcome (for example a click may have reached Leonardo but confirmation was lost), automatic resubmission should not claim certainty. The runtime should preserve an explicit uncertainty/reconciliation path to avoid accidental duplicate generations.

### Completion Check attempt

```text
load generationSession input
load required ACCOUNT affinity_ref
request a fresh runtime/profile binding constrained to affinity_ref
open Leonardo generation session
inspect UI
always release runtime/profile binding before returning
```

Results:

- success UI exists: download, persist to Z-s, emit report + optional video, release profile, return `DONE`;
- failed-generation UI exists: emit provider-failed report, release profile, return `DONE`;
- no terminal UI exists: release profile, return `POLLING`, next attempt after 30 seconds;
- script/runtime failure: release profile where possible, return `FAILED`.

## Policy values frozen for the draft Leonardo bundle

```yaml
submit:
  max_attempts: 3
  next_attempt_interval_seconds: 5
  max_script_runtime_seconds: TBD
  lease_seconds: TBD

completion_check:
  max_attempts: 5
  next_attempt_interval_seconds: 30
  max_script_runtime_seconds: TBD
  lease_seconds: TBD
```

No script invocation is permitted to keep a profile open during the interval between attempts.
