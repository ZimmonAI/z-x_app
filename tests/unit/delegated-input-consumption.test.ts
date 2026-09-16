import { describe, expect, it, vi } from 'vitest';
import { consumeDelegatedExactObject } from '../../src/adapters/types.js';
import type {
  ExactObjectReadInputV1,
  ExactObjectReadResultV1,
  ZStorageClient,
} from '../../src/clients/z-s.js';
import { ExecutionRequestV1Schema } from '../../src/contracts/v1/execution.js';
import { validRequest } from './test-request.js';

function requestWithInputAuthority() {
  return ExecutionRequestV1Schema.parse({
    ...validRequest(),
    delegatedAuthorities: [
      { name: 'input.primary.read', reference: 'zsauth_read_01HZX8R3Q5' },
    ],
  });
}

function contextWithReader(
  readExactObject: (
    input: ExactObjectReadInputV1,
    signal: AbortSignal,
  ) => Promise<ExactObjectReadResultV1>,
) {
  const storage = {
    readExactObject,
  } as unknown as ZStorageClient;
  return {
    request: requestWithInputAuthority(),
    storage,
    executionId: 'execution-1',
    attemptId: 'attempt-1',
    signal: new AbortController().signal,
  };
}

describe('controlled delegated exact-object input consumption', () => {
  it('routes one exact storageObjectId with the named frozen authority and no substitution', async () => {
    const readExactObject = vi.fn(async (input: ExactObjectReadInputV1) => ({
      storageObjectId: input.storageObjectId,
      mimeType: 'image/png',
      sizeBytes: 1,
      checksumSha256: 'a'.repeat(64),
      body: new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new Uint8Array([1]));
          controller.close();
        },
      }),
    }));
    const context = contextWithReader(readExactObject);

    const result = await consumeDelegatedExactObject(context, {
      authorityName: 'input.primary.read',
      storageObjectId: '018f8f6c-7d2e-7a11-8e5a-123456789abc',
    });

    expect(result.storageObjectId).toBe('018f8f6c-7d2e-7a11-8e5a-123456789abc');
    expect(readExactObject).toHaveBeenCalledTimes(1);
    expect(readExactObject).toHaveBeenCalledWith(
      {
        executionId: 'execution-1',
        attemptId: 'attempt-1',
        storageObjectId: '018f8f6c-7d2e-7a11-8e5a-123456789abc',
        readAuthorityRef: 'zsauth_read_01HZX8R3Q5',
      },
      context.signal,
    );
  });

  it('fails before storage access when the required delegated authority name is absent', async () => {
    const readExactObject = vi.fn();
    const context = contextWithReader(readExactObject);

    await expect(
      consumeDelegatedExactObject(context, {
        authorityName: 'input.missing.read',
        storageObjectId: '018f8f6c-7d2e-7a11-8e5a-123456789abc',
      }),
    ).rejects.toMatchObject({
      safe: {
        family: 'invalid-owner-request',
        code: 'ZX_DELEGATED_INPUT_AUTHORITY_REQUIRED',
        retryable: false,
      },
    });
    expect(readExactObject).not.toHaveBeenCalled();
  });

  it('propagates exact-object read failure and never retries against another identity', async () => {
    const failure = Object.assign(new Error('exact object unavailable'), {
      safe: {
        family: 'storage-input-failure',
        code: 'ZX_Z_S_INPUT_UNAVAILABLE',
        message: 'the exact Z-s input object is unavailable',
        retryable: false,
        traceId: 'trace',
      },
    });
    const readExactObject = vi.fn(async () => Promise.reject(failure));
    const context = contextWithReader(readExactObject);

    await expect(
      consumeDelegatedExactObject(context, {
        authorityName: 'input.primary.read',
        storageObjectId: '018f8f6c-7d2e-7a11-8e5a-123456789abc',
      }),
    ).rejects.toBe(failure);
    expect(readExactObject).toHaveBeenCalledTimes(1);
  });

  it('fails closed when a non-production storage client has no exact-object reader', async () => {
    const context = {
      ...contextWithReader(async () => {
        throw new Error('should not run');
      }),
      storage: {} as ZStorageClient,
    };

    await expect(
      consumeDelegatedExactObject(context, {
        authorityName: 'input.primary.read',
        storageObjectId: '018f8f6c-7d2e-7a11-8e5a-123456789abc',
      }),
    ).rejects.toMatchObject({
      safe: {
        family: 'adapter-unavailable',
        code: 'ZX_Z_S_EXACT_INPUT_READER_UNAVAILABLE',
        retryable: true,
      },
    });
  });
});
