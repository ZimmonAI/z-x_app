# Video Maker phase-engine schema manifest

This manifest describes the expected PostgreSQL schema after applying, in order:

1. `migrations/0001_execution_foundation_up.sql`
2. `migrations/0002_video_maker_phase_engine_up.sql`

It is the comparison source for the separate local database validation. It does not assert that any local, staging, or live database has been inspected.

## Migration policy

`0002_video_maker_phase_engine_up.sql` is corrected in place because the previously committed file fails PostgreSQL parsing with SQLSTATE `42601` and therefore cannot have been successfully applied as published. No forward `0003` migration is expected for this parser-only correction. If an environment contains a manually modified or partially managed equivalent schema, stop and compare it to this manifest before applying repository migrations.

## Schema summary

- Schema: `execution`
- Tables: 8
- Native PostgreSQL enum types: none
- Controlled value sets: implemented with `CHECK` constraints and listed below
- Required extensions: none

## Tables and columns

`NULL` means nullable. `NOT NULL` means required. Defaults are PostgreSQL expressions.

### `execution.execution_requests`

| Column | Type | Nullability | Default |
|---|---|---:|---|
| `id` | `uuid` | NOT NULL | none |
| `contract_version` | `text` | NOT NULL | none |
| `owner_app` | `text` | NOT NULL | none |
| `owner_action_id` | `text` | NOT NULL | none |
| `owner_project_id` | `text` | NULL | none |
| `idempotency_key` | `text` | NOT NULL | none |
| `request_fingerprint` | `character(64)` | NOT NULL | none |
| `operation_type` | `text` | NULL | none |
| `request_envelope` | `jsonb` | NOT NULL | none |
| `trace_id` | `text` | NOT NULL | none |
| `created_at` | `timestamp with time zone` | NOT NULL | `now()` |
| `tool_key` | `text` | NULL | none |
| `request_mode` | `text` | NULL | none |

Constraints:

- Primary key: `(id)`.
- Unique: `(owner_app, idempotency_key)`.
- Unique: `(owner_app, owner_action_id, request_fingerprint)`.
- `request_fingerprint ~ '^[a-f0-9]{64}$'`.
- `jsonb_typeof(request_envelope) = 'object'`.
- Named `execution_requests_contract_shape_check`: exactly one contract shape is valid:
  - Legacy: `contract_version = 'zx.execution.v1'`, `operation_type` is one of the legacy operation values, and `tool_key` plus `request_mode` are both null.
  - Video Maker: `contract_version = 'zx.video-maker.execution.v1'`, `operation_type` is null, `tool_key` is `consumer-gpt` or `google-flow`, and `request_mode` is `initial` or `regenerate`.

Foreign keys: none.

Indexes:

- Unique indexes backing the primary key and both unique constraints.
- `execution_requests_owner_action_idx` on `(owner_app, owner_action_id)`.
- `execution_requests_created_idx` on `(created_at)`.

Triggers:

- `execution_requests_immutable`: `BEFORE UPDATE OR DELETE`, calls `execution.reject_immutable_change()`.

### `execution.executions`

| Column | Type | Nullability | Default |
|---|---|---:|---|
| `id` | `uuid` | NOT NULL | none |
| `request_id` | `uuid` | NOT NULL | none |
| `status` | `text` | NOT NULL | none |
| `priority` | `smallint` | NOT NULL | `5` |
| `timeout_seconds` | `integer` | NOT NULL | `900` |
| `max_attempts` | `smallint` | NOT NULL | `3` |
| `current_attempt_number` | `smallint` | NOT NULL | `0` |
| `cancellation_requested_at` | `timestamp with time zone` | NULL | none |
| `result_envelope` | `jsonb` | NULL | none |
| `error_envelope` | `jsonb` | NULL | none |
| `terminal_at` | `timestamp with time zone` | NULL | none |
| `lock_version` | `bigint` | NOT NULL | `0` |
| `created_at` | `timestamp with time zone` | NOT NULL | `now()` |
| `updated_at` | `timestamp with time zone` | NOT NULL | `now()` |
| `selected_execution_method` | `text` | NULL | none |
| `current_phase_key` | `text` | NULL | none |
| `current_phase_ordinal` | `smallint` | NULL | none |
| `next_phase_eligible_at` | `timestamp with time zone` | NULL | none |
| `previous_execution_id` | `uuid` | NULL | none |
| `regeneration_feedback_snapshot` | `text` | NULL | none |
| `safe_continuation_ref` | `text` | NULL | none |

Constraints:

- Primary key: `(id)`.
- Unique: `(request_id)`.
- `priority BETWEEN 0 AND 9`.
- `timeout_seconds BETWEEN 30 AND 3600`.
- `max_attempts BETWEEN 1 AND 5`.
- `current_attempt_number BETWEEN 0 AND 5`.
- `lock_version >= 0`.
- `result_envelope` and `error_envelope`, when present, must be JSON objects.
- `result_envelope IS NULL OR error_envelope IS NULL`.
- A `succeeded` execution has a non-null result envelope.
- A `succeeded` or `cancelled` execution has non-null `terminal_at`.
- Named `executions_method_check`: method is null or one of the two Video Maker execution-method values.
- Named `executions_phase_pointer_check`: both phase fields are null, or exactly `submit/0`, `check-completion/1`, or `collect-and-store-result/2`.
- Named `executions_previous_not_self_check`: previous execution is null or differs from `id`.
- Named `executions_feedback_snapshot_check`: feedback is null or no more than 8192 octets.
- Named `executions_safe_continuation_ref_check`: continuation reference is null or 1–512 characters and matches `^[A-Za-z0-9][A-Za-z0-9._:-]*$`.

Foreign keys:

- `request_id` → `execution.execution_requests(id)`.
- `previous_execution_id` → `execution.executions(id)`.

Indexes:

- Unique indexes backing the primary key and `request_id` uniqueness.
- `executions_claim_idx` on `(status, priority DESC, created_at, id)`.
- `executions_terminal_idx` on `(status, terminal_at)`.
- `executions_video_maker_phase_claim_idx` on `(status, next_phase_eligible_at, priority DESC, created_at, id)`, partial where method and current phase are non-null.
- `executions_previous_execution_idx` on `(previous_execution_id)`, partial where previous execution is non-null.

Triggers:

- `executions_identity_immutable`: `BEFORE UPDATE`, calls `execution.guard_execution_identity()`.
- `executions_video_maker_regeneration_guard`: `BEFORE INSERT OR UPDATE OF previous_execution_id, request_id, safe_continuation_ref`, calls `execution.guard_video_maker_regeneration()`.

### `execution.execution_attempts`

| Column | Type | Nullability | Default |
|---|---|---:|---|
| `id` | `uuid` | NOT NULL | none |
| `execution_id` | `uuid` | NOT NULL | none |
| `attempt_number` | `smallint` | NOT NULL | none |
| `status` | `text` | NOT NULL | none |
| `worker_id` | `text` | NULL | none |
| `lease_token` | `uuid` | NULL | none |
| `lease_expires_at` | `timestamp with time zone` | NULL | none |
| `heartbeat_at` | `timestamp with time zone` | NULL | none |
| `route_snapshot` | `jsonb` | NULL | none |
| `capacity_snapshot` | `jsonb` | NULL | none |
| `adapter_id` | `text` | NULL | none |
| `adapter_version` | `text` | NULL | none |
| `external_run_ref` | `text` | NULL | none |
| `output_authorization_ref` | `text` | NULL | none |
| `safe_provider_output_ref` | `text` | NULL | none |
| `error_family` | `text` | NULL | none |
| `error_code` | `text` | NULL | none |
| `error_message` | `text` | NULL | none |
| `started_at` | `timestamp with time zone` | NOT NULL | none |
| `completed_at` | `timestamp with time zone` | NULL | none |
| `created_at` | `timestamp with time zone` | NOT NULL | `now()` |
| `updated_at` | `timestamp with time zone` | NOT NULL | `now()` |

Constraints:

- Primary key: `(id)`.
- Unique: `(execution_id, attempt_number)`.
- `attempt_number BETWEEN 1 AND 5`.
- Snapshots, when present, are JSON objects.
- Lease fields are either all null or all non-null: `lease_token`, `lease_expires_at`, `worker_id`, `heartbeat_at`.
- `status` and `error_family` are restricted to the controlled values below.

Foreign keys:

- `execution_id` → `execution.executions(id)`.

Indexes:

- Unique indexes backing the primary key and execution/attempt uniqueness.
- `execution_attempts_expired_idx` on `(status, lease_expires_at)`.
- `execution_attempts_history_idx` on `(execution_id, attempt_number DESC)`.
- `execution_attempts_run_idx` on `(external_run_ref)`, partial where non-null.

Triggers:

- `execution_attempt_snapshots_immutable`: `BEFORE UPDATE`, calls `execution.guard_attempt_snapshots()`.

### `execution.execution_status_transitions`

| Column | Type | Nullability | Default |
|---|---|---:|---|
| `id` | `bigint` | NOT NULL | `nextval('execution.execution_status_transitions_id_seq'::regclass)` |
| `event_key` | `uuid` | NOT NULL | none |
| `execution_id` | `uuid` | NOT NULL | none |
| `attempt_id` | `uuid` | NULL | none |
| `from_status` | `text` | NULL | none |
| `to_status` | `text` | NOT NULL | none |
| `reason_family` | `text` | NOT NULL | none |
| `actor_type` | `text` | NOT NULL | none |
| `actor_ref` | `text` | NULL | none |
| `trace_id` | `text` | NOT NULL | none |
| `safe_metadata` | `jsonb` | NOT NULL | `'{}'::jsonb` |
| `created_at` | `timestamp with time zone` | NOT NULL | `now()` |

Constraints:

- Primary key: `(id)`.
- Unique: `(event_key)`.
- `from_status`, when present, and `to_status` use the execution-status value set.
- `actor_type` is one of `api`, `worker`, `recovery`, `operator`, `system`.
- `safe_metadata` is a JSON object.

Foreign keys:

- `execution_id` → `execution.executions(id)`.
- `attempt_id` → `execution.execution_attempts(id)`.

Indexes:

- Unique indexes backing the primary key and `event_key`.
- `execution_transitions_execution_idx` on `(execution_id, id)`.
- `execution_transitions_attempt_idx` on `(attempt_id, id)`.
- `execution_transitions_created_idx` on `(created_at)`.

Triggers:

- `execution_transitions_append_only`: `BEFORE UPDATE OR DELETE`, calls `execution.reject_immutable_change()`.

### `execution.execution_delivery_attempts`

| Column | Type | Nullability | Default |
|---|---|---:|---|
| `id` | `uuid` | NOT NULL | none |
| `execution_id` | `uuid` | NOT NULL | none |
| `delivery_kind` | `text` | NOT NULL | none |
| `correlation_key` | `text` | NOT NULL | none |
| `status` | `text` | NOT NULL | none |
| `attempt_count` | `integer` | NOT NULL | `0` |
| `next_attempt_at` | `timestamp with time zone` | NOT NULL | none |
| `last_http_status` | `integer` | NULL | none |
| `last_error_family` | `text` | NULL | none |
| `last_error_message` | `text` | NULL | none |
| `delivered_at` | `timestamp with time zone` | NULL | none |
| `created_at` | `timestamp with time zone` | NOT NULL | `now()` |
| `updated_at` | `timestamp with time zone` | NOT NULL | `now()` |

Constraints:

- Primary key: `(id)`.
- Unique: `(execution_id, delivery_kind, correlation_key)`.
- `delivery_kind` is `polling` or `callback`.
- Delivery status uses the controlled values below.
- `attempt_count >= 0`.
- `last_http_status` is null or between 100 and 599.

Foreign keys:

- `execution_id` → `execution.executions(id)`.

Indexes:

- Unique indexes backing the primary key and delivery identity.
- `execution_delivery_due_idx` on `(status, next_attempt_at)`.

Triggers: none.

### `execution.execution_reconciliation_cases`

| Column | Type | Nullability | Default |
|---|---|---:|---|
| `id` | `uuid` | NOT NULL | none |
| `execution_id` | `uuid` | NOT NULL | none |
| `attempt_id` | `uuid` | NULL | none |
| `case_type` | `text` | NOT NULL | none |
| `status` | `text` | NOT NULL | none |
| `reason_family` | `text` | NOT NULL | none |
| `safe_details` | `jsonb` | NOT NULL | `'{}'::jsonb` |
| `detected_at` | `timestamp with time zone` | NOT NULL | none |
| `next_check_at` | `timestamp with time zone` | NOT NULL | none |
| `resolved_at` | `timestamp with time zone` | NULL | none |
| `resolution_code` | `text` | NULL | none |
| `created_at` | `timestamp with time zone` | NOT NULL | `now()` |
| `updated_at` | `timestamp with time zone` | NOT NULL | `now()` |

Constraints:

- Primary key: `(id)`.
- Named `execution_reconciliation_cases_case_type_check`: case type uses the controlled values below, including `phase-uncertainty`.
- Reconciliation status is `open`, `resolving`, `resolved`, or `closed`.
- `safe_details` is a JSON object.
- `(status IN ('resolved', 'closed')) = (resolved_at IS NOT NULL)`.

Foreign keys:

- `execution_id` → `execution.executions(id)`.
- `attempt_id` → `execution.execution_attempts(id)`.

Indexes:

- Unique index backing the primary key.
- `execution_reconciliation_open_unique` on `(execution_id, case_type)`, unique and partial where status is `open` or `resolving`.
- `execution_reconciliation_due_idx` on `(status, next_check_at)`.

Triggers: none.

### `execution.execution_phase_attempts`

| Column | Type | Nullability | Default |
|---|---|---:|---|
| `id` | `uuid` | NOT NULL | none |
| `execution_id` | `uuid` | NOT NULL | none |
| `phase_key` | `text` | NOT NULL | none |
| `phase_ordinal` | `smallint` | NOT NULL | none |
| `attempt_number` | `smallint` | NOT NULL | none |
| `status` | `text` | NOT NULL | none |
| `retry_count` | `smallint` | NOT NULL | `0` |
| `worker_id` | `text` | NOT NULL | none |
| `lease_token` | `uuid` | NOT NULL | none |
| `lease_expires_at` | `timestamp with time zone` | NOT NULL | none |
| `started_at` | `timestamp with time zone` | NOT NULL | none |
| `completed_at` | `timestamp with time zone` | NULL | none |
| `next_check_at` | `timestamp with time zone` | NULL | none |
| `runner_execution_ref` | `text` | NULL | none |
| `safe_continuation_ref` | `text` | NULL | none |
| `output_authorization_ref` | `text` | NULL | none |
| `safe_provider_output_ref` | `text` | NULL | none |
| `normalized_result` | `jsonb` | NULL | none |
| `normalized_failure` | `jsonb` | NULL | none |
| `created_at` | `timestamp with time zone` | NOT NULL | `now()` |

Constraints:

- Primary key: `(id)`.
- Unique: `(execution_id, phase_ordinal, attempt_number)`.
- Phase key, phase status, and bounds use the controlled values below.
- `phase_ordinal BETWEEN 0 AND 2`.
- `attempt_number BETWEEN 1 AND 5`.
- `retry_count BETWEEN 0 AND 4`.
- Running rows have null `completed_at`; every non-running row has non-null `completed_at`.
- Normalized result and failure, when present, are JSON objects and cannot both be non-null.
- Each safe reference is null or 1–512 characters matching `^[A-Za-z0-9][A-Za-z0-9._:-]*$`.

Foreign keys:

- `execution_id` → `execution.executions(id)`.

Indexes:

- Unique indexes backing the primary key and phase-attempt identity.
- `execution_phase_attempts_claim_idx` on `(status, lease_expires_at)`.
- `execution_phase_attempts_history_idx` on `(execution_id, phase_ordinal, attempt_number)`.
- `execution_phase_attempts_runner_idx` on `(runner_execution_ref)`, partial where non-null.

Triggers:

- `execution_phase_attempts_guard`: `BEFORE UPDATE OR DELETE`, calls `execution.guard_completed_phase_attempt()`.

### `execution.execution_phase_evidence`

| Column | Type | Nullability | Default |
|---|---|---:|---|
| `id` | `bigint` | NOT NULL | `nextval('execution.execution_phase_evidence_id_seq'::regclass)` |
| `event_key` | `uuid` | NOT NULL | none |
| `execution_id` | `uuid` | NOT NULL | none |
| `phase_attempt_id` | `uuid` | NOT NULL | none |
| `evidence_kind` | `text` | NOT NULL | none |
| `safe_evidence` | `jsonb` | NOT NULL | `'{}'::jsonb` |
| `created_at` | `timestamp with time zone` | NOT NULL | `now()` |

Constraints:

- Primary key: `(id)`.
- Unique: `(event_key)`.
- Evidence kind uses the controlled values below.
- `safe_evidence` is a JSON object and its text representation is no more than 16384 octets.

Foreign keys:

- `execution_id` → `execution.executions(id)`.
- `phase_attempt_id` → `execution.execution_phase_attempts(id)`.

Indexes:

- Unique indexes backing the primary key and `event_key`.
- `execution_phase_evidence_execution_idx` on `(execution_id, id)`.
- `execution_phase_evidence_attempt_idx` on `(phase_attempt_id, id)`.

Triggers:

- `execution_phase_evidence_append_only`: `BEFORE UPDATE OR DELETE`, calls `execution.reject_immutable_change()`.

## Controlled values

There are no native enum types. These exact text values are enforced by `CHECK` constraints.

- Legacy operation type: `image_prompt.prepare.v1`, `image.generate.v1`, `scene_video_prompt.prepare.v1`, `scene_video.generate.v1`.
- Video Maker tool key: `consumer-gpt`, `google-flow`.
- Request mode: `initial`, `regenerate`.
- Execution method: `video-maker-consumer-gpt-fixture-v1`, `video-maker-google-flow-fixture-v1`.
- Execution/current transition status: `accepted`, `resolving-route`, `waiting-capacity`, `queued`, `running`, `succeeded`, `failed`, `cancelled`, `timed-out`, `reconciliation-required`.
- Legacy execution-attempt status: `created`, `resolving-route`, `waiting-capacity`, `queued`, `running`, `succeeded`, `failed`, `cancelled`, `timed-out`, `reconciliation-required`.
- Attempt error family: `invalid-owner-request`, `route-not-found`, `route-deactivated`, `route-parameter-validation`, `no-eligible-capacity`, `login-required`, `account-attention`, `adapter-unavailable`, `provider-rejected`, `timeout`, `cancelled`, `malformed-output`, `storage-output-failure`, `callback-failure`, `reconciliation-required`, `internal-safe-failure`.
- Transition actor type: `api`, `worker`, `recovery`, `operator`, `system`.
- Delivery kind: `polling`, `callback`.
- Delivery status: `pending`, `delivering`, `delivered`, `failed`, `reconciliation-required`.
- Reconciliation case type: `manual-retry`, `lost-result`, `lease-loss`, `operator-request`, `storage-completion`, `owner-delivery`, `cleanup-failure`, `poison-job`, `phase-uncertainty`.
- Reconciliation status: `open`, `resolving`, `resolved`, `closed`.
- Phase key: `submit`, `check-completion`, `collect-and-store-result`.
- Phase-attempt status: `running`, `done`, `waiting`, `retryable-failure`, `terminal-failure`, `stopped`, `uncertain`.
- Evidence kind: `claimed`, `outcome`, `lease-recovered`, `shutdown`, `reconciliation`.

## Functions and trigger behavior

Expected functions in schema `execution`:

- `reject_immutable_change()` — always rejects mutation with `immutable row`.
- `guard_execution_identity()` — protects execution identity/policy fields, immutable continuation references, and terminal Video Maker truth.
- `guard_attempt_snapshots()` — makes populated route and capacity snapshots immutable.
- `guard_video_maker_regeneration()` — enforces tool/method alignment, immutable request lineage, same-owner regeneration, terminal eligibility, and inherited safe continuation reference.
- `guard_completed_phase_attempt()` — prohibits phase-attempt deletion, completed-attempt mutation, and phase-attempt identity mutation.

## Constraint-name note

Constraints explicitly named in migration SQL must match the names above. Primary-key, unique, foreign-key, and inline `CHECK` constraints that were declared without `CONSTRAINT <name>` may have PostgreSQL-generated names. The validator must compare their table, columns, referenced table/columns, and normalized definition rather than treating a generated name as an application contract.

## Local validation procedure

Use Node `>=22 <23`, npm `10.9.2`, and a disposable PostgreSQL database. Never paste its URL into GitHub.

1. Manually synchronize the corrective PR revision.
2. Set `ZX_TEST_DATABASE_URL` only in the local shell/process environment.
3. Run `npm ci`.
4. Run the narrow migration check: `npm run test:integration -- tests/integration/migration-up-down.test.ts`.
5. Run all integration tests: `npm run test:integration`.
6. Run the migration commands against the disposable database: `npm run db:migrate` and then `npm run db:rollback`.
7. Reapply migrations and compare `information_schema`, `pg_constraint`, `pg_indexes`, `pg_trigger`, `pg_proc`, and the controlled values to this manifest.
8. Record the PostgreSQL server version, source revision, commands, and results in the local validation report.

Do not report Task 02 fully complete until the online CI is green and this applicable local database validation has passed.
