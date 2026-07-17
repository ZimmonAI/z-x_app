# Operations

No operational start, key provisioning, port assignment, database action, or canary has been executed by this source task. The manifest keeps all three runtime ports and URLs `null`, leaves every action disabled, and records the API dependency on the fixture authority.

A later authorized registration handoff may provide the nine `ZX_FIXTURE_AUTH_*` variables and `ZX_WORKER_CONTROL_DIR` through its approved secret/config lane. The fixture env utility is `scripts/provision-fixture-auth.mjs`; it generates one P-256 key pair, emits one physical line per variable, writes scalar values directly, and writes the private JWK and public JWKS as compact raw JSON immediately after `=`. It refuses overwrite unless `--replace` is explicit and prints only the destination path, `ES256`, and the public fingerprint. It never prints key/JWKS bodies, token content, or complete env contents.

The exact authorized provisioning syntax is:

```text
node scripts/provision-fixture-auth.mjs --env-file <exact-path> --port <registered-port> --bind-host 127.0.0.1
```

The fixture auth runtime is loopback-only. `0.0.0.0` is forbidden, and the runtime has no browser, Tailscale, public, or manifest `localUrl`. Only the loopback health pattern `http://127.0.0.1:<auth-port>/internal/health` and JWKS pattern `http://127.0.0.1:<auth-port>/.well-known/jwks.json` are used internally. Issuer, audience, algorithm, and 300-second TTL are fixed source constants rather than CLI arguments. `--replace` is allowed only for an explicitly authorized replacement.

The token client is `npm run fixture-auth:mint`. It requires `--env-file`, exact `--owner-app z-x-deployment-canary`, one or more repeated allowlisted `--scope` values, and `--output-file`. It writes the JWT only to the output file, enforces the configured issuer and audience, and refuses unknown scopes, empty owner, malformed key configuration, or TTL above 300 seconds.

The worker control command is `npm run worker:request-stop`. `ZX_WORKER_CONTROL_DIR` contains runtime-only `stop.request.json` and `stop.ack.json` files. The worker checks for a request during each idle loop, invokes its existing shutdown controller, stops claiming work, allows active work to finish for up to 30 seconds, closes the pool, and acknowledges the matching request. The command waits up to 35 seconds, removes the acknowledgement after reading it, and exits nonzero on timeout or `drain-timeout`.

Future runtime order remains separately governed: register unresolved ports and secret bindings, start fixture auth before the API, start the worker as API support, prove readiness, and only then authorize a bounded fixture canary. Real dependencies and callbacks remain disabled.
