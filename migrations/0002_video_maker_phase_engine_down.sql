BEGIN;

DO $$
DECLARE
  row_count bigint;
  video_maker_count bigint;
BEGIN
  SELECT
    (SELECT count(*) FROM execution.execution_phase_attempts) +
    (SELECT count(*) FROM execution.execution_phase_evidence)
  INTO row_count;

  SELECT count(*)
    INTO video_maker_count
    FROM execution.execution_requests
   WHERE contract_version = 'zx.video-maker.execution.v1';

  IF row_count > 0 OR video_maker_count > 0 THEN
    RAISE EXCEPTION 'refusing destructive rollback: video-maker execution data exists';
  END IF;
END
$$;

DROP TRIGGER execution_phase_evidence_append_only ON execution.execution_phase_evidence;
DROP TRIGGER execution_phase_attempts_guard ON execution.execution_phase_attempts;
DROP TRIGGER executions_video_maker_regeneration_guard ON execution.executions;
DROP TABLE execution.execution_phase_evidence;
DROP TABLE execution.execution_phase_attempts;
DROP FUNCTION execution.guard_completed_phase_attempt();
DROP FUNCTION execution.guard_video_maker_regeneration();

ALTER TABLE execution.execution_reconciliation_cases
  DROP CONSTRAINT execution_reconciliation_cases_case_type_check;
ALTER TABLE execution.execution_reconciliation_cases
  ADD CONSTRAINT execution_reconciliation_cases_case_type_check CHECK (case_type IN (
    'manual-retry', 'lost-result', 'lease-loss', 'operator-request',
    'storage-completion', 'owner-delivery', 'cleanup-failure', 'poison-job'
  ));

DROP INDEX execution.executions_previous_execution_idx;
DROP INDEX execution.executions_video_maker_phase_claim_idx;

ALTER TABLE execution.executions
  DROP CONSTRAINT executions_safe_continuation_ref_check,
  DROP CONSTRAINT executions_feedback_snapshot_check,
  DROP CONSTRAINT executions_previous_not_self_check,
  DROP CONSTRAINT executions_phase_pointer_check,
  DROP CONSTRAINT executions_method_check,
  DROP COLUMN safe_continuation_ref,
  DROP COLUMN regeneration_feedback_snapshot,
  DROP COLUMN previous_execution_id,
  DROP COLUMN next_phase_eligible_at,
  DROP COLUMN current_phase_ordinal,
  DROP COLUMN current_phase_key,
  DROP COLUMN selected_execution_method;

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

ALTER TABLE execution.execution_requests
  DROP CONSTRAINT execution_requests_contract_shape_check,
  DROP COLUMN request_mode,
  DROP COLUMN tool_key;

ALTER TABLE execution.execution_requests
  ALTER COLUMN operation_type SET NOT NULL,
  ADD CONSTRAINT execution_requests_contract_version_check
    CHECK (contract_version = 'zx.execution.v1'),
  ADD CONSTRAINT execution_requests_operation_type_check CHECK (operation_type IN (
    'image_prompt.prepare.v1',
    'image.generate.v1',
    'scene_video_prompt.prepare.v1',
    'scene_video.generate.v1'
  ));

COMMIT;
