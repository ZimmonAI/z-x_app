BEGIN;

ALTER TABLE execution.execution_requests
  DROP CONSTRAINT execution_requests_contract_shape_check;

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
    OR
    (
      contract_version = 'zx.execution.v2'
      AND operation_type = 'generic.execute.v2'
      AND tool_key IS NULL
      AND request_mode IS NULL
    )
  );

COMMENT ON CONSTRAINT execution_requests_contract_shape_check
  ON execution.execution_requests IS
  'Allows legacy zx.execution.v1, Video Maker compatibility, and generic zx.execution.v2 request envelopes without widening legacy worker routing.';

COMMIT;
