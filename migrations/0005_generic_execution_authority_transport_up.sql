BEGIN;

ALTER TABLE execution.execution_requests
  DROP CONSTRAINT execution_requests_contract_version_check;
ALTER TABLE execution.execution_requests
  ADD CONSTRAINT execution_requests_contract_version_check
  CHECK (contract_version IN ('zx.execution.v1', 'zx.execution.v2'));

ALTER TABLE execution.execution_requests
  DROP CONSTRAINT execution_requests_operation_type_check;
ALTER TABLE execution.execution_requests
  ADD CONSTRAINT execution_requests_operation_type_check
  CHECK (operation_type IN (
    'image_prompt.prepare.v1',
    'image.generate.v1',
    'scene_video_prompt.prepare.v1',
    'scene_video.generate.v1',
    'generic.execute.v2'
  ));

COMMENT ON CONSTRAINT execution_requests_contract_version_check
  ON execution.execution_requests IS
  'Allows legacy zx.execution.v1 plus generic zx.execution.v2 frozen request envelopes.';
COMMENT ON CONSTRAINT execution_requests_operation_type_check
  ON execution.execution_requests IS
  'generic.execute.v2 is a persistence marker only; legacy workers remain explicitly allowlisted to v1 operations.';

COMMIT;
