# Z-X Execution Runner

Fixture-first source foundation for the governed `zx.execution.v1` contract. It implements exactly four generic operations: image prompt preparation, image generation, scene-video prompt preparation, and scene-video generation.

## Source-only setup

Use Node.js 22 and npm. Validation uses five in-process `fixture-v1` dependency clients plus an ephemeral PostgreSQL database supplied as `ZX_TEST_DATABASE_URL`.

```bash
npm ci
npm run validate
```

The source now defines three disabled, unresolved runtimes: `z-x-fixture-auth`, `z-x-execution-runner-api`, and `z-x-execution-runner-worker`. The API depends on the fixture authority, and the worker remains a support runtime of the API. Source manifests assign no ports or URLs and enable no runtime actions.

## Fixture-only authentication

`z-x-fixture-auth` is a private test authority owned by `@zimspace/z-x-execution-runner`; it is not a production identity provider. It serves only `GET /internal/health` and the public ES256 JWKS at `GET /.well-known/jwks.json`. It fails closed unless the exact fixture issuer `urn:zimspace:z-x:fixture-auth`, audience `z-x-execution-runner`, 300-second token limit, key ID, private JWK, and matching public JWKS are supplied through the nine `ZX_FIXTURE_AUTH_*` variables listed in `.env.example`.

The Node-built-in provisioning utility writes key material only to the caller-provided file and never prints private key content:

```bash
node -- scripts/provision-fixture-auth.mjs --env-file <authorized-env-file> --port <registered-port>
```

The mint command requires the exact canary owner `z-x-deployment-canary`, one or more repeated allowlisted `--scope` arguments, and a caller-provided token output file. It writes the token only to that file:

```bash
npm run fixture-auth:mint -- --env-file <authorized-env-file> --owner-app z-x-deployment-canary --scope zx.executions.submit --output-file <token-output-file>
```

Allowed scopes are `zx.executions.submit`, `zx.executions.read`, `zx.executions.cancel`, `zx.executions.retry`, and `zx.executions.reconcile`.

## Graceful worker control

When `ZX_WORKER_CONTROL_DIR` is configured, the worker observes `stop.request.json` during its normal loop. A valid request enters the existing `ShutdownController` path, stops new claims, drains active work for the existing 30-second deadline, closes the database pool, and writes `stop.ack.json` with only safe request, result, and timestamp fields. The request command waits at most 35 seconds and exits nonzero for timeout or `drain-timeout`:

```bash
npm run worker:request-stop
```

`.runtime/` is ignored and excluded from package output. This source change does not provision a live key, select a port, start a process, access a live database, submit a canary, enable a real dependency, or claim deployment or release evidence.
