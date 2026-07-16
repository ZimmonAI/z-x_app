BEGIN;
DO $$
DECLARE n bigint;
BEGIN
 SELECT (SELECT count(*) FROM execution.execution_requests)+(SELECT count(*) FROM execution.executions)+(SELECT count(*) FROM execution.execution_attempts)+(SELECT count(*) FROM execution.execution_status_transitions)+(SELECT count(*) FROM execution.execution_delivery_attempts)+(SELECT count(*) FROM execution.execution_reconciliation_cases) INTO n;
 IF n>0 THEN RAISE EXCEPTION 'refusing destructive rollback: execution tables are not empty'; END IF;
END $$;
DROP TABLE execution.execution_reconciliation_cases;
DROP TABLE execution.execution_delivery_attempts;
DROP TABLE execution.execution_status_transitions;
DROP TABLE execution.execution_attempts;
DROP TABLE execution.executions;
DROP TABLE execution.execution_requests;
DROP FUNCTION execution.reject_snapshot_change();
DROP FUNCTION execution.reject_immutable_change();
DROP SCHEMA execution;
COMMIT;
