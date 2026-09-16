# Z-X Execution Runner

This repository is the neutral Z-X runtime foundation after the generic-runtime/storage reset cleanup.

It intentionally does **not** implement an execution-method model, business/job taxonomy, provider selection, Video Maker orchestration, generated-media adapters, delegated Z-s output storage, or registered storage connections. The exact immutable method runtime and registered-storage/output-object model belong to the next governed implementation task.

## Preserved foundation

The current source keeps reusable platform primitives only:

- authenticated owner/client isolation and execution API boundaries;
- execution identity, idempotency/fingerprint, cancellation/retry/reconciliation state;
- PostgreSQL pool/transaction and migration foundations;
- worker lease/heartbeat/control/shutdown primitives;
- safe logging/observability and fixture authentication;
- a generic temporary-artifact primitive;
- one canonical host-neutral runtime configuration owner in `src/config.ts`.

`POST /internal/v1/executions` currently accepts a strict neutral `zx.execution.v1` envelope with opaque structured `payload`. It deliberately has no `operationType`, tool/provider/model selector, delegated authority, generated-media field, storage output request, or `executionMethodId`. Task 02 owns the future exact-method contract.

## Worker state

The worker process is intentionally inert in this cleanup checkpoint. It starts, observes the existing graceful stop-control channel, and shuts down cleanly, but it does not claim or execute work until the generic method runtime is implemented.

## Validation

Use Node.js 24 and npm. Full validation requires an ephemeral PostgreSQL database supplied as `ZX_TEST_DATABASE_URL`:

```bash
npm ci
npm run validate
```

Validation runs typecheck, lint, neutral unit/contract/integration/failure tests, build, the migration chain up/down, package checks, and manifest checks.

## Database migration note

Migration history `0001` and `0002` is retained because the vault records that the historical `execution` schema was accepted/applied. `0003_neutral_foundation_cleanup` is the forward destructive cleanup that removes the active Video Maker phase schema and legacy request taxonomy without pretending historical migrations never existed.

This repository commit does not by itself prove that `0003` has been applied to any live database. Live application and live-schema verification must be performed through the governed database/runtime lane before documentation may claim live convergence.

## Fixture-only authentication

`z-x-fixture-auth` remains a private test authority. The existing provisioning/mint scripts continue to write secret/token material only to caller-authorized files. Do not commit runtime secrets or generated env files.

## Graceful worker control

When `ZX_WORKER_CONTROL_DIR` is configured, the worker observes `stop.request.json`, enters `ShutdownController`, and writes a safe `stop.ack.json` after shutdown. The request helper remains:

```bash
npm run worker:request-stop
```
