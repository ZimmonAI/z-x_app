import type { ExecutionRequestV1 } from '../contracts/v1/execution.js';
import type { ZProviderRouteClient } from '../clients/z-provider.js';
import type { ZAccountCapacityClient } from '../clients/z-account.js';
import type { ZStorageClient } from '../clients/z-s.js';
import { getAdapter } from '../adapters/registry.js';

export async function executeFixturePath(
  request: ExecutionRequestV1,
  executionId: string,
  deps: {
    routes: ZProviderRouteClient;
    capacity: ZAccountCapacityClient;
    storage: ZStorageClient;
  },
  signal = new AbortController().signal,
) {
  const route = await deps.routes.resolveAndValidateRoute(
    { operation: request.operationType, routeLocks: request.routeLocks },
    signal,
  );
  const capacity = await deps.capacity.acquire({ route }, signal);
  const adapter = getAdapter(
    request.operationType,
    route.adapterId,
    route.adapterVersion,
    route.invocationMode,
  );

  try {
    return await adapter.execute({
      request,
      route,
      capacity,
      executionId,
      signal,
      completeMedia: async (mimeType) => {
        const authorization = await deps.storage.createOutputAuthorization(
          { executionId, mimeType },
          signal,
        );
        return deps.storage.completeOrIngestOutput(
          {
            authorizationRef: authorization.authorizationRef,
            safeProviderOutputRef: 'provider-output-fixture-0001',
            mimeType,
          },
          signal,
        );
      },
    });
  } finally {
    await deps.capacity.release({ leaseRef: capacity.leaseRef }, signal);
  }
}
