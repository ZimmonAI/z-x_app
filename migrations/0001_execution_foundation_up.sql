BEGIN;

CREATE SCHEMA IF NOT EXISTS execution;
REVOKE ALL ON SCHEMA execution FROM PUBLIC;

CREATE TABLE execution.execution_requests (
  id uuid PRIMARY KEY,
  contract_version text NOT NULL CHECK (contract_version = 'zx.execution.v1'),
  owner_app text NOT NULL,
  owner_action_id text NOT NULL,
  owner_project_id text,
  idempotency_key text NOT NULL,
  request_fingerprint char(64) NOT NULL CHECK (request_fingerprint ~ '^[a-f0-9]{64}$'),
  operation_type text NOT NULL CHECK (operation_type IN (
    'image_prompt.prepare.v1',
    'image.generate.v1',
    'scene_video_prompt.prepare.v1',
    'scene_video.generate.v1'
  )),
  request_envelope jsonb NOT NULL CHECK (jsonb_typeof(request_envelope) = 'object'),
  trace_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (owner_app, idempotency_key),
  UNIQUE (owner_app, owner_action_id, request_fingerprint)
);
CREATE INDEX execution_requests_owner_action_idx
  ON execution.execution_requests (owner_app, owner_action_id);
CREATE INDEX execution_requests_created_idx
  ON execution.execution_requests (created_at);

CREATE TABLE execution.executions (
  id uuid PRIMARY KEY,
  request_id uuid NOT NULL UNIQUE REFERENCES execution.execution_requests(id),
  status text NOT NULL CHECK (status IN (
    'accepted', 'resolving-route', 'waiting-capacity', 'queued', 'running',
    'succeeded', 'failed', 'cancelled', 'timed-out', 'reconciliation-required'
  )),
  priority smallint NOT NULL DEFAULT 5 CHECK (priority BETWEEN 0 AND 9),
  timeout_seconds integer NOT NULL DEFAULT 900 CHECK (timeout_seconds BETWEEN 30 AND 3600),
  max_attempts smallint NOT NULL DEFAULT 3 CHECK (max_attempts BETWEEN 1 AND 5),
  current_attempt_number smallint NOT NULL DEFAULT 0 CHECK (current_attempt_number BETWEEN 0 AND 5),
  cancellation_requested_at timestamptz,
  result_envelope jsonb CHECK (result_envelope IS NULL OR jsonb_typeof(result_envelope) = 'object'),
  error_envelope jsonb CHECK (error_envelope IS NULL OR jsonb_typeof(error_envelope) = 'object'),
  terminal_at timestamptz,
  lock_version bigint NOT NULL DEFAULT 0 CHECK (lock_version >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (result_envelope IS NULL OR error_envelope IS NULL),
  CHECK (status <> 'succeeded' OR result_envelope IS NOT NULL),
  CHECK (status NOT IN ('succeeded', 'cancelled') OR terminal_at IS NOT NULL)
);
CREATE INDEX executions_claim_idx
  ON execution.executions (status, priority DESC, created_at, id);
CREATE INDEX executions_terminal_idx
  ON execution.executions (status, terminal_at);

CREATE TABLE execution.execution_attempts (
  id uuid PRIMARY KEY,
  execution_id uuid NOT NULL REFERENCES execution.executions(id),
  attempt_number smallint NOT NULL CHECK (attempt_number BETWEEN 1 AND 5),
  status text NOT NULL CHECK (status IN (
    'created', 'resolving-route', 'waiting-capacity', 'queued', 'running',
    'succeeded', 'failed', 'cancelled', 'timed-out', 'reconciliation-required'
  )),
  worker_id text,
  lease_token uuid,
  lease_expires_at timestamptz,
  heartbeat_at timestamptz,
  route_snapshot jsonb CHECK (route_snapshot IS NULL OR jsonb_typeof(route_snapshot) = 'object'),
  capacity_snapshot jsonb CHECK (capacity_snapshot IS NULL OR jsonb_typeof(capacity_snapshot) = 'object'),
  adapter_id text,
  adapter_version text,
  external_run_ref text,
  output_authorization_ref text,
  safe_provider_output_ref text,
  error_family text CHECK (error_family IS NULL OR error_family IN (
    'invalid-owner-request', 'route-not-found', 'route-deactivated',
    'route-parameter-validation', 'no-eligible-capacity', 'login-required',
    'account-attention', 'adapter-unavailable', 'provider-rejected', 'timeout',
    'cancelled', 'malformed-output', 'storage-output-failure', 'callback-failure',
    'reconciliation-required', 'internal-safe-failure'
  )),
  error_code text,
  error_message text,
  started_at timestamptz NOT NULL,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (execution_id, attempt_number),
  CHECK (
    (lease_token IS NULL AND lease_expires_at IS NULL AND worker_id IS NULL AND heartbeat_at IS NULL)
    OR
    (lease_token IS NOT NULL AND lease_expires_at IS NOT NULL AND worker_id IS NOT NULL AND heartbeat_at IS NOT NULL)
  )
);
CREATE INDEX execution_attempts_expired_idx
  ON execution.execution_attempts (status, lease_expires_at);
CREATE INDEX execution_attempts_history_idx
  ON execution.execution_attempts (execution_id, attempt_number DESC);
CREATE INDEX execution_attempts_run_idx
  ON execution.execution_attempts (external_run_ref)
  WHERE external_run_ref IS NOT NULL;

CREATE TABLE execution.execution_status_transitions (
  id bigserial PRIMARY KEY,
  event_key uuid NOT NULL UNIQUE,
  execution_id uuid NOT NULL REFERENCES execution.executions(id),
  attempt_id uuid REFERENCES execution.execution_attempts(id),
  from_status text CHECK (from_status IS NULL OR from_status IN (
    'accepted', 'resolving-route', 'waiting-capacity', 'queued', 'running',
    'succeeded', 'failed', 'cancelled', 'timed-out', 'reconciliation-required'
  )),
  to_status text NOT NULL CHECK (to_status IN (
    'accepted', 'resolving-route', 'waiting-capacity', 'queued', 'running',
    'succeeded', 'failed', 'cancelled', 'timed-out', 'reconciliation-required'
  )),
  reason_family text NOT NULL,
  actor_type text NOT NULL CHECK (actor_type IN ('api', 'worker', 'recovery', 'operator', 'system')),
  actor_ref text,
  trace_id text NOT NULL,
  safe_metadata jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(safe_metadata) = 'object'),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX execution_transitions_execution_idx
  ON execution.execution_status_transitions (execution_id, id);
CREATE INDEX execution_transitions_attempt_idx
  ON execution.execution_status_transitions (attempt_id, id);
CREATE INDEX execution_transitions_created_idx
  ON execution.execution_status_transitions (created_at);

CREATE TABLE execution.execution_delivery_attempts (
  id uuid PRIMARY KEY,
  execution_id uuid NOT NULL REFERENCES execution.executions(id),
  delivery_kind text NOT NULL CHECK (delivery_kind IN ('polling', 'callback')),
  correlation_key text NOT NULL,
  status text NOT NULL CHECK (status IN (
    'pending', 'delivering', 'delivered', 'failed', 'reconciliation-required'
  )),
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  next_attempt_at timestamptz NOT NULL,
  last_http_status integer CHECK (last_http_status IS NULL OR last_http_status BETWEEN 100 AND 599),
  last_error_family text,
  last_error_message text,
  delivered_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (execution_id, delivery_kind, correlation_key)
);
CREATE INDEX execution_delivery_due_idx
  ON execution.execution_delivery_attempts (status, next_attempt_at);

CREATE TABLE execution.execution_reconciliation_cases (
  id uuid PRIMARY KEY,
  execution_id uuid NOT NULL REFERENCES execution.executions(id),
  attempt_id uuid REFERENCES execution.execution_attempts(id),
  case_type text NOT NULL CHECK (case_type IN (
    'manual-retry', 'lost-result', 'lease-loss', 'operator-request',
    'storage-completion', 'owner-delivery', 'cleanup-failure', 'poison-job'
  )),
  status text NOT NULL CHECK (status IN ('open', 'resolving', 'resolved', 'closed')),
  reason_family text NOT NULL,
  safe_details jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(safe_details) = 'object'),
  detected_at timestamptz NOT NULL,
  next_check_at timestamptz NOT NULL,
  resolved_at timestamptz,
  resolution_code text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((status IN ('resolved', 'closed')) = (resolved_at IS NOT NULL))
);
CREATE UNIQUE INDEX execution_reconciliation_open_unique
  ON execution.execution_reconciliation_cases (execution_id, case_type)
  WHERE status IN ('open', 'resolving');
CREATE INDEX execution_reconciliation_due_idx
  ON execution.execution_reconciliation_cases (status, next_check_at);

CREATE OR REPLACE FUNCTION execution.reject_immutable_change()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'immutable row';
END
$$;

CREATE OR REPLACE FUNCTION execution.guard_execution_identity()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.request_id IS DISTINCT FROM OLD.request_id
     OR NEW.priority IS DISTINCT FROM OLD.priority
     OR NEW.timeout_seconds IS DISTINCT FROM OLD.timeout_seconds
     OR NEW.max_attempts IS DISTINCT FROM OLD.max_attempts
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'execution identity and policy fields are immutable';
  END IF;
  RETURN NEW;
END
$$;

CREATE OR REPLACE FUNCTION execution.guard_attempt_snapshots()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.route_snapshot IS NOT NULL AND NEW.route_snapshot IS DISTINCT FROM OLD.route_snapshot THEN
    RAISE EXCEPTION 'route snapshot is immutable';
  END IF;
  IF OLD.capacity_snapshot IS NOT NULL AND NEW.capacity_snapshot IS DISTINCT FROM OLD.capacity_snapshot THEN
    RAISE EXCEPTION 'capacity snapshot is immutable';
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER execution_requests_immutable
BEFORE UPDATE OR DELETE ON execution.execution_requests
FOR EACH ROW EXECUTE FUNCTION execution.reject_immutable_change();

CREATE TRIGGER execution_transitions_append_only
BEFORE UPDATE OR DELETE ON execution.execution_status_transitions
FOR EACH ROW EXECUTE FUNCTION execution.reject_immutable_change();

CREATE TRIGGER executions_identity_immutable
BEFORE UPDATE ON execution.executions
FOR EACH ROW EXECUTE FUNCTION execution.guard_execution_identity();

CREATE TRIGGER execution_attempt_snapshots_immutable
BEFORE UPDATE ON execution.execution_attempts
FOR EACH ROW EXECUTE FUNCTION execution.guard_attempt_snapshots();

DO $$
DECLARE
  item record;
  api_role text := nullif(current_setting('zx.api_role', true), '');
  worker_role text := nullif(current_setting('zx.worker_role', true), '');
BEGIN
  FOR item IN
    SELECT table_name, column_name
      FROM information_schema.columns
     WHERE table_schema = 'execution'
  LOOP
    EXECUTE format(
      'COMMENT ON COLUMN execution.%I.%I IS %L',
      item.table_name,
      item.column_name,
      'Z-X execution field ' || item.column_name || '. Ref: z-kn/08-execution/mvp-dev_project_video-maker_app/tasks/in-progress/mvp-end-to-end-tool-runtime-execution/10-build-z-x-execution-runner/02-report-z-x-implementation-plan.md'
    );
  END LOOP;

  REVOKE ALL ON ALL TABLES IN SCHEMA execution FROM PUBLIC;
  REVOKE ALL ON ALL SEQUENCES IN SCHEMA execution FROM PUBLIC;

  IF api_role IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = api_role) THEN
      RAISE EXCEPTION 'configured zx.api_role does not exist';
    END IF;
    EXECUTE format('GRANT USAGE ON SCHEMA execution TO %I', api_role);
    EXECUTE format(
      'GRANT SELECT, INSERT, UPDATE ON execution.execution_requests, execution.executions, execution.execution_attempts, execution.execution_status_transitions, execution.execution_reconciliation_cases TO %I',
      api_role
    );
    EXECUTE format('GRANT USAGE, SELECT ON SEQUENCE execution.execution_status_transitions_id_seq TO %I', api_role);
  END IF;

  IF worker_role IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = worker_role) THEN
      RAISE EXCEPTION 'configured zx.worker_role does not exist';
    END IF;
    EXECUTE format('GRANT USAGE ON SCHEMA execution TO %I', worker_role);
    EXECUTE format(
      'GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA execution TO %I',
      worker_role
    );
    EXECUTE format('GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA execution TO %I', worker_role);
  END IF;
END
$$;

COMMENT ON SCHEMA execution IS
  'Z-X generic execution persistence. Ref: z-kn/08-execution/mvp-dev_project_video-maker_app/tasks/in-progress/mvp-end-to-end-tool-runtime-execution/10-build-z-x-execution-runner/02-report-z-x-implementation-plan.md';
COMMENT ON TABLE execution.execution_requests IS
  'Immutable owner request envelope and idempotency authority. Ref: z-kn/08-execution/mvp-dev_project_video-maker_app/tasks/in-progress/mvp-end-to-end-tool-runtime-execution/10-build-z-x-execution-runner/02-report-z-x-implementation-plan.md';
COMMENT ON TABLE execution.executions IS
  'Current normalized generic execution state. Ref: z-kn/08-execution/mvp-dev_project_video-maker_app/tasks/in-progress/mvp-end-to-end-tool-runtime-execution/10-build-z-x-execution-runner/02-report-z-x-implementation-plan.md';
COMMENT ON TABLE execution.execution_attempts IS
  'Per-dispatch attempts, leases, safe route/capacity snapshots and outcomes. Ref: z-kn/08-execution/mvp-dev_project_video-maker_app/tasks/in-progress/mvp-end-to-end-tool-runtime-execution/10-build-z-x-execution-runner/02-report-z-x-implementation-plan.md';
COMMENT ON TABLE execution.execution_status_transitions IS
  'Append-only lifecycle and audit history. Ref: z-kn/08-execution/mvp-dev_project_video-maker_app/tasks/in-progress/mvp-end-to-end-tool-runtime-execution/10-build-z-x-execution-runner/02-report-z-x-implementation-plan.md';
COMMENT ON TABLE execution.execution_delivery_attempts IS
  'Idempotent owner delivery attempt state. Ref: z-kn/08-execution/mvp-dev_project_video-maker_app/tasks/in-progress/mvp-end-to-end-tool-runtime-execution/10-build-z-x-execution-runner/02-report-z-x-implementation-plan.md';
COMMENT ON TABLE execution.execution_reconciliation_cases IS
  'Explicit uncertainty and repair cases. Ref: z-kn/08-execution/mvp-dev_project_video-maker_app/tasks/in-progress/mvp-end-to-end-tool-runtime-execution/10-build-z-x-execution-runner/02-report-z-x-implementation-plan.md';

COMMIT;
