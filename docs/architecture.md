# Neutral foundation architecture

This document describes the active source state after the generic runtime/storage reset cleanup.

## Active responsibilities

Z-X currently owns only generic platform foundations:

- authenticated owner isolation for the internal execution API;
- immutable owner request identity and idempotency/fingerprint handling;
- generic execution lifecycle persistence and safe reconciliation records;
- worker lease, heartbeat, stop-control, and shutdown primitives;
- safe logging/observability, fixture auth, and host-neutral runtime configuration;
- a reusable temporary-artifact primitive.

## Deliberately absent

The active source does not define a Video Maker engine, generated-media job taxonomy, tool-to-method mapping, provider/model selection contract, hard-coded submit/check/collect phases, delegated Z-s output ownership, storage connection registry, output-object registry, or generic execution-method runtime.

The worker executable is intentionally inert and does not claim work until the next governed task implements the exact immutable execution-method runtime.

## Persistence

Historical migrations remain as history. `0003_neutral_foundation_cleanup` removes the rejected active schema additions and forms a one-way rollback boundary. A source migration is not proof of live database application; live verification belongs to the governed database lane.
