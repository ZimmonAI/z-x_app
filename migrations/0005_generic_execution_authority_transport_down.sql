BEGIN;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM execution.execution_requests
     WHERE contract_version = 'zx.execution.v2'
        OR operation_type = 'generic.execute.v2'
  ) THEN
    RAISE EXCEPTION 'refusing rollback: generic execution v2 requests exist';
  END IF;
END
$$;

ALTER TABLE execution.execution_requests
  DROP CONSTRAINT execution_requests_contract_version_check;
ALTER TABLE execution.execution_requests
  ADD CONSTRAINT execution_requests_contract_version_check
  CHECK (contract_version = 'zx.execution.v1');

ALTER TABLE execution.execution_requests
  DROP CONSTRAINT execution_requests_operation_type_check;
ALTER TABLE execution.execution_requests
  ADD CONSTRAINT execution_requests_operation_type_check
  CHECK (operation_type IN (
    'image_prompt.prepare.v1',
    'image.generate.v1',
    'scene_video_prompt.prepare.v1',
    'scene_video.generate.v1'
  ));

COMMIT;
