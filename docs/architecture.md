# Architecture

Z-X owns only generic execution requests, attempts, lifecycle transitions, owner delivery attempts, and reconciliation cases. Z-Provider owns route/catalog truth; z-account owns live capacity/account/session truth; Auto-Hub owns registered execution runs; Z-s owns durable storage identity; Video Maker owns business sequencing and business writes.

The package exposes two independent processes: an authenticated Fastify API and a PostgreSQL-only durable worker. Claiming uses `FOR UPDATE SKIP LOCKED`, lease-token compare-and-swap, 60-second leases, 20-second heartbeats, a 30-second recovery scan, and a 30-second shutdown drain. `fixture-v1` clients are deterministic and in-process. Real clients fail closed until owner-published versioned contracts are enabled.
