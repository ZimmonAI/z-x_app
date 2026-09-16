BEGIN;

-- This cleanup is intentionally destructive. Rolling back migration 0003 alone
-- does not recreate the rejected Video Maker/tool/storage compatibility model.
-- Full ephemeral validation rollback continues through 0002_down and 0001_down.
DO $$
BEGIN
  RAISE NOTICE '0003 neutral-foundation cleanup is one-way by design';
END
$$;

COMMIT;
