# Operations

No operational start has been executed. Before any future runtime action, a separate authorized handoff must assign a governed port, supply an approved secret/config route, create/apply the `z_x.execution` migration on the authorized target only, verify comments and least privilege, and validate readiness.

Future order: migration, API readiness, worker with real dependencies disabled, one-operation canary, owner canary. Monitor backlog age, lease loss, reconciliation cases, safe internal failures, storage completion, and delivery retries. Real dependencies and operation flags are enabled one family at a time; `ZX_CANARY_PERCENT` starts at 0.
