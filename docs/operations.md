# Operations

No operational start, key provisioning, port assignment, database action, or canary has been executed by this source task. The manifest keeps all three runtime ports and URLs `null`, leaves every action disabled, and records the API dependency on the fixture authority.

A later authorized registration handoff may provide the nine `ZX_FIXTURE_AUTH_*` variables and `ZX_WORKER_CONTROL_DIR` through its approved secret/config lane. The fixture env utility is `scripts/provision-fixture-auth.mjs`; it requires a caller-provided env path and registered port, refuses overwrite unless `--replace` is explicit, generates one P-256 key pair, and prints only the path, `ES256`, and public fingerprint. It must not be used to populate API, database, worker, provider, browser, or storage values.

Node.js 22 defines `--env-file` as a Node CLI option. The end-of-options delimiter is therefore mandatory so the fixture provisioner's argument reaches the script. Use exactly this loopback-only provisioning command after the env path and port are authorized:

```text
node -- scripts/provision-fixture-auth.mjs --env-file <exact-path> --port <registered-port> --bind-host 127.0.0.1
```

The utility writes exactly nine variables with one physical line per variable. It rejects CR or LF in every emitted value. Scalar values remain safe single-line values; `ZX_FIXTURE_AUTH_PRIVATE_JWK_JSON` and `ZX_FIXTURE_AUTH_PUBLIC_JWKS_JSON` are compact raw JSON immediately after `=`, with no outer quote pair and no backslash-escaped JSON quotes. This format is consumed correctly by the current Zimspace Status env loader, which removes only one matching outer quote pair and performs no JSON unescaping. Fixture auth remains loopback-only, rejects `0.0.0.0`, and has no browser, Tailscale, or public `localUrl`.

The token client is `npm run fixture-auth:mint`. It requires `--env-file`, exact `--owner-app z-x-deployment-canary`, one or more repeated allowlisted `--scope` values, and `--output-file`. It writes the JWT only to the output file, enforces the configured issuer and audience, and refuses unknown scopes, empty owner, malformed key configuration, or TTL above 300 seconds.

The worker control command is `npm run worker:request-stop`. `ZX_WORKER_CONTROL_DIR` contains runtime-only `stop.request.json` and `stop.ack.json` files. The worker checks for a request during each idle loop, invokes its existing shutdown controller, stops claiming work, allows active work to finish for up to 30 seconds, closes the pool, and acknowledges the matching request. The command waits up to 35 seconds, removes the acknowledgement after reading it, and exits nonzero on timeout or `drain-timeout`.

Future runtime order remains separately governed: register unresolved ports and secret bindings, start fixture auth before the API, start the worker as API support, prove readiness, and only then authorize a bounded fixture canary. Real dependencies and callbacks remain disabled.
