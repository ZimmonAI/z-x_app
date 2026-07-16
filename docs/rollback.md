# Rollback

The down migration is permitted only while all six tables are empty and refuses otherwise. After data exists, rollback means stop claims, drain for up to 30 seconds, keep status reads available where safe, deploy the prior backward-compatible application version, retain the schema and audit/reconciliation history, and repair uncertain attempts explicitly. Destructive rollback requires separate approval plus backup/restore evidence.

For a later authorized runtime rollback, request worker shutdown through `npm run worker:request-stop` and require the matching `stop.ack.json` result before Status reconciliation. The request uses the existing `ShutdownController`; it does not bypass the drain deadline. A `drain-timeout` is a failed stop outcome and must remain visible rather than being reported as graceful completion.

Fixture-auth rollback is source and runtime cleanup only: stop the private fixture runtime, remove caller-owned token output and fixture env material through the authorized secret lane, and leave real identity-provider integration disabled. The repository contains no generated live key, token, assigned port, public URL, or deployment evidence.
