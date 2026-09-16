BEGIN;

-- Historical migrations 0001/0002 are intentionally retained because they may
-- already be recorded in an accepted environment. This forward migration makes
-- the active schema neutral without restoring the rejected runtime model.

DROP TABLE IF EXISTS execution.execution_phase_evidence;
DROP TABLE IF EXISTS execution.execution_phase_attempts;

DROP TRIGGER IF EXISTS executions_video_maker_regeneration_guard ON execution.executions;
DROP FUNCTION IF EXISTS execution.guard_video_maker_regeneration();
DROP FUNCTION IF EXISTS execution.guard_completed_phase_attempt();

DROP INDEX IF EXISTS execution.executions_video_maker_phase_claim_idx;
DROP INDEX IF EXISTS execution.executions_previous_execution_idx;

ALTER TABLE execution.execution_requests
  DROP CONSTRAINT IF EXISTS execution_requests_contract_shape_check,
  DROP CONSTRAINT IF EXISTS execution_requests_contract_version_check,
  DROP CONSTRAINT IF EXISTS execution_requests_operation_type_check;

ALTER TABLE execution.execution_requests
  DROP COLUMN IF EXISTS operation_type,
  DROP COLUMN IF EXISTS tool_key,
  DROP COLUMN IF EXISTS request_mode;

ALTER TABLE execution.execution_requests
  ADD CONSTRAINT execution_requests_contract_version_check
  CHECK (contract_version = 'zx.execution.v1');

ALTER TABLE execution.executions
  DROP CONSTRAINT IF EXISTS executions_method_check,
  DROP CONSTRAINT IF EXISTS executions_phase_pointer_check,
  DROP CONSTRAINT IF EXISTS executions_previous_not_self_check,
  DROP CONSTRAINT IF EXISTS executions_feedback_snapshot_check,
  DROP CONSTRAINT IF EXISTS executions_safe_continuation_ref_check;

ALTER TABLE execution.executions
  DROP COLUMN IF EXISTS selected_execution_method,
  DROP COLUMN IF EXISTS current_phase_key,
  DROP COLUMN IF EXISTS current_phase_ordinal,
  DROP COLUMN IF EXISTS next_phase_eligible_at,
  DROP COLUMN IF EXISTS previous_execution_id,
  DROP COLUMN IF EXISTS regeneration_feedback_snapshot,
  DROP COLUMN IF EXISTS safe_continuation_ref;

ALTER TABLE execution.execution_attempts
  DROP COLUMN IF EXISTS output_authorization_ref;

ALTER TABLE execution.execution_reconciliation_cases
  DROP CONSTRAINT IF EXISTS execution_reconciliation_cases_case_type_check;
ALTER TABLE execution.execution_reconciliation_cases
  ADD CONSTRAINT execution_reconciliation_cases_case_type_check CHECK (case_type IN (
    'manual-retry', 'lost-result', 'lease-loss', 'operator-request',
    'storage-completion', 'owner-delivery', 'cleanup-failure', 'poison-job'
  ));

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
END;
$$;

COMMENT ON SCHEMA execution IS
  'Neutral Z-X execution persistence foundation. Business/job taxonomy, execution methods, and registered storage are not defined by this cleanup migration.';
COMMENT ON TABLE execution.execution_requests IS
  'Immutable owner execution request envelope and idempotency authority; neutral foundation only.';
COMMENT ON TABLE execution.executions IS
  'Current generic execution identity and lifecycle state; neutral foundation only.';
COMMENT ON TABLE execution.execution_attempts IS
  'Generic execution attempt, lease, runtime evidence, and safe provider reference foundation.';

COMMIT;
