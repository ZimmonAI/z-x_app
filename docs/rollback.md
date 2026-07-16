# Rollback

The down migration is permitted only while all six tables are empty and refuses otherwise. After data exists, rollback means stop claims, drain for up to 30 seconds, keep status reads available where safe, deploy the prior backward-compatible application version, retain the schema and audit/reconciliation history, and repair uncertain attempts explicitly. Destructive rollback requires separate approval plus backup/restore evidence.
