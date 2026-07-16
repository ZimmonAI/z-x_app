# Z-X Execution Runner

Fixture-first source foundation for the governed `zx.execution.v1` contract. It implements exactly four generic operations: image prompt preparation, image generation, scene-video prompt preparation, and scene-video generation.

## Source-only setup

Use Node.js 22 and npm. Validation is deterministic and uses five in-process `fixture-v1` dependency clients plus an ephemeral PostgreSQL database supplied as `ZX_TEST_DATABASE_URL`.

```bash
npm ci && ZX_TEST_DATABASE_URL=postgresql://... npm run validate
```

The repository contains migration source for database `z_x`, schema `execution`; it does not create the database. Real dependency clients fail closed, callbacks are disabled, runtime ports and URLs are `null`, and manifest actions are disabled. This source does not claim live database, runtime, provider, storage, browser/profile, deployment, or release readiness.
