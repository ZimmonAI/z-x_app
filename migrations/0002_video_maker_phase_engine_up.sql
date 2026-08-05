BEGIN;

ALTER TABLE execution.execution_requests
  DROP CONSTRAINT IF EXISTS execution_requests_contract_version_check,
  DROP CONSTRAINT IF EXISTS execution_requests_operation_type_check;

ALTER TABLE execution.execution_requests
  ALTER COLUMN operation_type DROP NOT NULL,
  ADD COLUMN tool_key text,
  ADD COLUMN request_mode text;

ALTER TABLE execution.execution_requests
  ADD CONSTRAINT execution_requests_contract_shape_check CHECK (
    (
      contract_version = 'zx.execution.v1'
      AND operation_type IN (
        'image_prompt.prepare.v1',
        'image.generate.v1',
        'scene_video_prompt.prepare.v1',
        'scene_video.generate.v1'
      )
      AND tool_key IS NULL
      AND request_mode IS NULL
    )
    OR
    (
      contract_version = 'zx.video-maker.execution.v1'
      AND operation_type IS NULL
      AND tool_key IN ('consumer-gpt', 'google-flow')
      AND request_mode IN ('initial', 'regenerate')
    )
  );

ALTER TABLE execution.executions
  ADD COLUMN selected_execution_method text,
  ADD COLUMN current_phase_key text,
  ADD COLUMN current_phase_ordinal smallint,
  ADD COLUMN next_phase_eligible_at timestamptz,
  ADD COLUMN previous_execution_id uuid REFERENCES execution.executions(id),
  ADD COLUMN regeneration_feedback_snapshot text,
  ADD COLUMN safe_continuation_ref text;

ALTER TABLE execution.executions
  ADD CONSTRAINT executions_method_check CHECK (
    selected_execution_method IS NULL OR selected_execution_method IN (
      'video-maker-consumer-gpt-fixture-v1',
      'video-maker-google-flow-fixture-v1'
    )
  ),
  ADD CONSTRAINT executions_phase_pointer_check CHECK (
    (current_phase_key IS NULL AND current_phase_ordinal IS NULL)
    OR (current_phase_key = 'submit' AND current_phase_ordinal = 0)
    OR (current_phase_key = 'check-completion' AND current_phase_ordinal = 1)
    OR (current_phase_key = 'collect-and-store-result' AND current_phase_ordinal = 2)
  ),
  ADD CONSTRAINT executions_previous_not_self_check CHECK (
    previous_execution_id IS NULL OR previous_execution_id <> id
  ),
  ADD CONSTRAINT executions_feedback_snapshot_check CHECK (
    regeneration_feedback_snapshot IS NULL
    OR octet_length(regeneration_feedback_snapshot) <= 8192
  ),
  ADD CONSTRAINT executions_safe_continuation_ref_check CHECK (
    safe_continuation_ref IS NULL
    OR (
      length(safe_continuation_ref) BETWEEN 1 AND 512
      AND safe_continuation_ref ~ '^[A-Za-z0-9][A-Za-z0-9._:-]*$'
    )
  );

CREATE INDEX executions_video_maker_phase_claim_idx
  ON execution.executions (status, next_phase_eligible_at, priority DESC, created_at, id)
  WHERE selected_execution_method IS NOT NULL AND current_phase_key IS NOT NULL;
CREATE INDEX executions_previous_execution_idx
  ON execution.executions (previous_execution_id)
  WHERE previous_execution_id IS NOT NULL;

ALTER TABLE execution.execution_reconciliation_cases
  DROP CONSTRAINT IF EXISTS execution_reconciliation_cases_case_type_check;
ALTER TABLE execution.execution_reconciliation_cases
  ADD CONSTRAINT execution_reconciliation_cases_case_type_check CHECK (case_type IN (
    'manual-retry', 'lost-result', 'lease-loss', 'operator-request',
    'storage-completion', 'owner-delivery', 'cleanup-failure', 'poison-job',
    'phase-uncertainty'
  ));

CREATE TABLE execution.execution_phase_attempts (
  id uuid PRIMARY KEY,
  execution_id uuid NOT NULL REFERENCES execution.executions(id),
  phase_key text NOT NULL CHECK (phase_key IN (
    'submit', 'check-completion', 'collect-and-store-result'
  )),
  phase_ordinal smallint NOT NULL CHECK (phase_ordinal BETWEEN 0 AND 2),
  attempt_number smallint NOT NULL CHECK (attempt_number BETWEEN 1 AND 5),
  status text NOT NULL CHECK (status IN (
    'running', 'done', 'waiting', 'retryable-failure',
    'terminal-failure', 'stopped', 'uncertain'
  )),
  retry_count smallint NOT NULL DEFAULT 0 CHECK (retry_count BETWEEN 0 AND 4),
  worker_id text NOT NULL,
  lease_token uuid NOT NULL,
  lease_expires_at timestamptz NOT NULL,
  started_at timestamptz NOT NULL,
  completed_at timestamptz,
  next_check_at timestamptz,
  runner_execution_ref text,
  safe_continuation_ref text,
  output_authorization_ref text,
  safe_provider_output_ref text,
  normalized_result jsonb CHECK (
    normalized_result IS NULL OR jsonb_typeof(normalized_result) = 'object'
  ),
  normalized_failure jsonb CHECK (
    normalized_failure IS NULL OR jsonb_typeof(normalized_failure) = 'object'
  ),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (execution_id, phase_ordinal, attempt_number),
  CHECK (
    (status = 'running' AND completed_at IS NULL)
    OR (status <> 'running' AND completed_at IS NOT NULL)
  ),
  CHECK (normalized_result IS NULL OR normalized_failure IS NULL),
  CHECK (
    runner_execution_ref IS NULL OR (
      length(runner_execution_ref) BETWEEN 1 AND 512
      AND runner_execution_ref ~ '^[A-Za-z0-9][A-Za-z0-9._:-]*$'
    )
  ),
  CHECK (
    safe_continuation_ref IS NULL OR (
      length(safe_continuation_ref) BETWEEN 1 AND 512
      AND safe_continuation_ref ~ '^[A-Za-z0-9][A-Za-z0-9._:-]*$'
    )
  ),
  CHECK (
    output_authorization_ref IS NULL OR (
      length(output_authorization_ref) BETWEEN 1 AND 512
      AND output_authorization_ref ~ '^[A-Za-z0-9][A-Za-z0-9._:-]*$'
    )
  ),
  CHECK (
    safe_provider_output_ref IS NULL OR (
      length(safe_provider_output_ref) BETWEEN 1 AND 512
      AND safe_provider_output_ref ~ '^[A-Za-z0-9][A-Za-z0-9._:-]*$'
    )
  )
);
CREATE INDEX execution_phase_attempts_claim_idx
  ON execution.execution_phase_attempts (status, lease_expires_at);
CREATE INDEX execution_phase_attempts_history_idx
  ON execution.execution_phase_attempts (execution_id, phase_ordinal, attempt_number);
CREATE INDEX execution_phase_attempts_runner_idx
  ON execution.execution_phase_attempts (runner_execution_ref)
  WHERE runner_execution_ref IS NOT NULL;

CREATE TABLE execution.execution_phase_evidence (
  id bigserial PRIMARY KEY,
  event_key uuid NOT NULL UNIQUE,
  execution_id uuid NOT NULL REFERENCES execution.executions(id),
  phase_attempt_id uuid NOT NULL REFERENCES execution.execution_phase_attempts(id),
  evidence_kind text NOT NULL CHECK (evidence_kind IN (
    'claimed', 'outcome', 'lease-recovered', 'shutdown', 'reconciliation'
  )),
  safe_evidence jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (
    jsonb_typeof(safe_evidence) = 'object'
    AND octet_length(safe_evidence::text) <= 16384
  ),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX execution_phase_evidence_execution_idx
  ON execution.execution_phase_evidence (execution_id, id);
CREATE INDEX execution_phase_evidence_attempt_idx
  ON execution.execution_phase_evidence (phase_attempt_id, id);

CREATE OR REPLACE FUNCTION execution.guard_execution_identity()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.request_id IS DISTINCT FROM OLD.request_id
     OR NEW.priority IS DISTINCT FROM OLD.priority
     OR NEW.timeout_seconds IS DISTINCT FROM OLD.timeout_seconds
     OR NEW.max_attempts IS DISTINCT FROM OLD.max_attempts
     OR NEW.selected_execution_method IS DISTINCT FROM OLD.selected_execution_method
     OR NEW.previous_execution_id IS DISTINCT FROM OLD.previous_execution_id
     OR NEW.regeneration_feedback_snapshot IS DISTINCT FROM OLD.regeneration_feedback_snapshot
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'execution identity and policy fields are immutable';
  END IF;
  IF OLD.safe_continuation_ref IS NOT NULL
     AND NEW.safe_continuation_ref IS DISTINCT FROM OLD.safe_continuation_ref THEN
    RAISE EXCEPTION 'safe continuation reference is immutable once recorded';
  END IF;
  IF OLD.selected_execution_method IS NOT NULL
     AND OLD.status IN ('succeeded', 'failed', 'cancelled')
     AND (
       NEW.status IS DISTINCT FROM OLD.status
       OR NEW.result_envelope IS DISTINCT FROM OLD.result_envelope
       OR NEW.error_envelope IS DISTINCT FROM OLD.error_envelope
       OR NEW.terminal_at IS DISTINCT FROM OLD.terminal_at
       OR NEW.current_phase_key IS DISTINCT FROM OLD.current_phase_key
       OR NEW.current_phase_ordinal IS DISTINCT FROM OLD.current_phase_ordinal
       OR NEW.next_phase_eligible_at IS DISTINCT FROM OLD.next_phase_eligible_at
       OR NEW.safe_continuation_ref IS DISTINCT FROM OLD.safe_continuation_ref
     ) THEN
    RAISE EXCEPTION 'terminal video-maker execution truth is immutable';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION execution.guard_video_maker_regeneration()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  current_owner text;
  current_contract_version text;
  current_request_mode text;
  current_tool_key text;
  current_previous_execution_id text;
  current_feedback text;
  previous_owner text;
  previous_status text;
  previous_continuation text;
BEGIN
  SELECT r.owner_app, r.contract_version, r.request_mode, r.tool_key,
         r.request_envelope->>'previousExecutionId', r.request_envelope->>'feedback'
    INTO current_owner, current_contract_version, current_request_mode, current_tool_key,
         current_previous_execution_id, current_feedback
    FROM execution.execution_requests r
   WHERE r.id = NEW.request_id;

  IF current_contract_version <> 'zx.video-maker.execution.v1' THEN
    IF NEW.previous_execution_id IS NOT NULL
       OR NEW.regeneration_feedback_snapshot IS NOT NULL
       OR NEW.safe_continuation_ref IS NOT NULL THEN
      RAISE EXCEPTION 'legacy executions cannot carry Video Maker lineage';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.selected_execution_method IS DISTINCT FROM CASE current_tool_key
       WHEN 'consumer-gpt' THEN 'video-maker-consumer-gpt-fixture-v1'
       WHEN 'google-flow' THEN 'video-maker-google-flow-fixture-v1'
       ELSE NULL
     END THEN
    RAISE EXCEPTION 'Video Maker execution method does not match tool key';
  END IF;

  IF NEW.regeneration_feedback_snapshot IS DISTINCT FROM current_feedback THEN
    RAISE EXCEPTION 'regeneration feedback snapshot does not match the immutable request';
  END IF;

  IF current_request_mode = 'initial' THEN
    IF NEW.previous_execution_id IS NOT NULL
       OR current_previous_execution_id IS NOT NULL
       OR NEW.regeneration_feedback_snapshot IS NOT NULL THEN
      RAISE EXCEPTION 'initial Video Maker execution cannot carry regeneration lineage';
    END IF;
    RETURN NEW;
  END IF;

  IF current_request_mode <> 'regenerate'
     OR NEW.previous_execution_id IS NULL
     OR current_previous_execution_id IS DISTINCT FROM NEW.previous_execution_id::text THEN
    RAISE EXCEPTION 'regeneration requires the immutable request previous execution';
  END IF;

  SELECT r.owner_app, e.status, e.safe_continuation_ref
    INTO previous_owner, previous_status, previous_continuation
    FROM execution.executions e
    JOIN execution.execution_requests r ON r.id = e.request_id
   WHERE e.id = NEW.previous_execution_id;

  IF previous_owner IS NULL THEN
    RAISE EXCEPTION 'previous execution does not exist';
  END IF;
  IF current_owner IS DISTINCT FROM previous_owner THEN
    RAISE EXCEPTION 'cross-owner regeneration is prohibited';
  END IF;
  IF previous_status NOT IN ('succeeded', 'failed') THEN
    RAISE EXCEPTION 'previous execution is not regeneration eligible';
  END IF;
  IF previous_continuation IS NULL THEN
    RAISE EXCEPTION 'previous execution lacks a safe continuation reference';
  END IF;
  IF NEW.safe_continuation_ref IS DISTINCT FROM previous_continuation THEN
    RAISE EXCEPTION 'regeneration must inherit the prior safe continuation reference';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION execution.guard_completed_phase_attempt()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'phase attempts cannot be deleted';
  END IF;
  IF OLD.status <> 'running' AND NEW IS DISTINCT FROM OLD THEN
    RAISE EXCEPTION 'completed phase attempt is immutable';
  END IF;
  IF OLD.execution_id IS DISTINCT FROM NEW.execution_id
     OR OLD.phase_key IS DISTINCT FROM NEW.phase_key
     OR OLD.phase_ordinal IS DISTINCT FROM NEW.phase_ordinal
     OR OLD.attempt_number IS DISTINCT FROM NEW.attempt_number
     OR OLD.worker_id IS DISTINCT FROM NEW.worker_id
     OR OLD.lease_token IS DISTINCT FROM NEW.lease_token
     OR OLD.started_at IS DISTINCT FROM NEW.started_at
     OR OLD.created_at IS DISTINCT FROM NEW.created_at THEN
    RAISE EXCEPTION 'phase attempt identity is immutable';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER executions_video_maker_regeneration_guard
BEFORE INSERT OR UPDATE OF previous_execution_id, request_id, safe_continuation_ref
ON execution.executions
FOR EACH ROW EXECUTE FUNCTION execution.guard_video_maker_regeneration();

CREATE TRIGGER execution_phase_attempts_guard
BEFORE UPDATE OR DELETE ON execution.execution_phase_attempts
FOR EACH ROW EXECUTE FUNCTION execution.guard_completed_phase_attempt();

CREATE TRIGGER execution_phase_evidence_append_only
BEFORE UPDATE OR DELETE ON execution.execution_phase_evidence
FOR EACH ROW EXECUTE FUNCTION execution.reject_immutable_change();

DO $$
DECLARE
  api_role text := nullif(current_setting('zx.api_role', true), '');
  worker_role text := nullif(current_setting('zx.worker_role', true), '');
BEGIN
  REVOKE ALL ON execution.execution_phase_attempts FROM PUBLIC;
  REVOKE ALL ON execution.execution_phase_evidence FROM PUBLIC;
  REVOKE ALL ON SEQUENCE execution.execution_phase_evidence_id_seq FROM PUBLIC;

  IF api_role IS NOT NULL THEN
    EXECUTE format(
      'GRANT SELECT ON execution.execution_phase_attempts, execution.execution_phase_evidence TO %I',
      api_role
    );
    EXECUTE format(
      'GRANT USAGE, SELECT ON SEQUENCE execution.execution_phase_evidence_id_seq TO %I',
      api_role
    );
  END IF;

  IF worker_role IS NOT NULL THEN
    EXECUTE format(
      'GRANT SELECT, INSERT, UPDATE ON execution.execution_phase_attempts TO %I',
      worker_role
    );
    EXECUTE format(
      'GRANT SELECT, INSERT ON execution.execution_phase_evidence TO %I',
      worker_role
    );
    EXECUTE format(
      'GRANT USAGE, SELECT ON SEQUENCE execution.execution_phase_evidence_id_seq TO %I',
      worker_role
    );
  END IF;
END;
$$;

COMMENT ON TABLE execution.execution_phase_attempts IS
  'Bounded attempts for the generic Video Maker submit, check-completion, and collect-and-store-result phases. Ref: z-kn/08-execution/z-x-mvp-dev/tasks/in-progress/video-maker-tool-execution-mvp/02-implement-execution-persistence-and-phase-engine.md';
COMMENT ON TABLE execution.execution_phase_evidence IS
  'Append-only bounded technical evidence for Video Maker phase attempts. Ref: z-kn/08-execution/z-x-mvp-dev/tasks/in-progress/video-maker-tool-execution-mvp/02-implement-execution-persistence-and-phase-engine.md';
COMMENT ON COLUMN execution.executions.safe_continuation_ref IS
  'Opaque immutable conversation or continuation reference safe for regeneration; never credentials, cookies, browser state, or unrestricted URLs.';

COMMIT;
