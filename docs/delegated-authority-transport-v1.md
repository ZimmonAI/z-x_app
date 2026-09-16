# Delegated technical authority transport

`zx.execution.v1` can carry bounded opaque technical authority references alongside the frozen execution payload.

## Contract

```json
{
  "delegatedAuthorities": [
    {
      "name": "input.primary.read",
      "reference": "zsauth_read_01HZX8R3Q5"
    },
    {
      "name": "output.primary.write",
      "reference": "zsauth_write_01HZX8R3Q6"
    }
  ]
}
```

`name` is a script/execution-method local lookup key. Z-X does not assign storage business meaning to it. `reference` must be an opaque bounded reference; URLs, provider coordinates, credentials, bearer material, bucket/prefix/object-key material, and other destination-selection details are rejected by the generic execution contract.

The request schema allows at most 32 delegated authority references and requires unique names. The complete parsed request is already persisted in the immutable `execution.execution_requests.request_envelope` JSONB field, so no schema migration is required. Worker execution already receives the parsed request intact through the existing lifecycle and adapter context.

Execution code can retrieve one exact reference with `getDelegatedAuthorityReference(request, name)`. The helper performs lookup only; it does not mint authority, discover storage services, choose destinations, or interpret provider configuration.

## Security boundary

Z-X transports the opaque reference only. The owning application and Z-s remain responsible for creating and validating the bounded authority. Z-X must not receive the owner's long-lived Z-s integration bearer and must not expose delegated authority references in normal API result envelopes, logs, traces, or generic output payloads.

Legacy `ownerStorageAccess`, storage-output fixture behavior, and existing operation compatibility remain unchanged. New generic execution work should use `delegatedAuthorities` rather than introducing new app-specific storage fields in the generic request envelope.
