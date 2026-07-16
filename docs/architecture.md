# Architecture

Z-X owns only generic execution requests, attempts, lifecycle transitions, owner delivery attempts, and reconciliation cases. Z-Provider owns route/catalog truth; z-account owns live capacity/account/session truth; Auto-Hub owns registered execution runs; Z-s owns durable storage identity; Video Maker owns business sequencing and business writes.

The package exposes three independent source entrypoints: a fixture-only authentication runtime, an authenticated Fastify API, and a PostgreSQL-only durable worker. The API manifest depends on `z-x-fixture-auth`; the worker remains a support runtime of `z-x-execution-runner-api`.

The fixture authority is private and deliberately narrow. It accepts only the fixed issuer `urn:zimspace:z-x:fixture-auth`, audience `z-x-execution-runner`, algorithm `ES256`, and a matching P-256 key pair whose `kid` is the RFC 7638 public-key thumbprint. It serves only a safe health response and the public JWKS, never private key material, token content, environment values, stack traces, or a general identity-provider surface. Minting is limited to 300 seconds, owner app `z-x-deployment-canary`, and the five Z-X execution scopes.

Claiming uses `FOR UPDATE SKIP LOCKED`, lease-token compare-and-swap, 60-second leases, 20-second heartbeats, a 30-second recovery scan, and the existing 30-second `ShutdownController` drain. File-based worker control is only a source-owned trigger around that same drain path: `stop.request.json` starts shutdown, the request is consumed, active work drains, the pool closes, and `stop.ack.json` reports `drained` or `drain-timeout` with safe timestamps. `fixture-v1` dependency clients remain deterministic and in-process. Real clients fail closed until owner-published versioned contracts are enabled.
