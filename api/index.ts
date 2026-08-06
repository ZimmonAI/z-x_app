import type { IncomingMessage, ServerResponse } from 'node:http';
import { buildServer } from '../src/api/server.js';
import { loadConfig } from '../src/config.js';

type Application = Awaited<ReturnType<typeof buildServer>>;

let applicationPromise: Promise<Application> | undefined;

async function getApplication(): Promise<Application> {
  applicationPromise ??= (async () => {
    const application = await buildServer({
      config: loadConfig({
        ...process.env,
        ZX_NODE_ENV: process.env.ZX_NODE_ENV ?? 'production',
      }),
    });
    await application.ready();
    return application;
  })();

  try {
    return await applicationPromise;
  } catch (error) {
    applicationPromise = undefined;
    throw error;
  }
}

function publicRequestUrl(request: IncomingMessage): string {
  const rewritten = new URL(request.url ?? '/', 'http://vercel.internal');
  const capturedPath = rewritten.searchParams.get('__zx_path');

  if (capturedPath === null) {
    return request.url ?? '/';
  }

  rewritten.searchParams.delete('__zx_path');
  const normalizedPath = capturedPath.replace(/^\/+/, '');
  const query = rewritten.searchParams.toString();
  return `/${normalizedPath}${query ? `?${query}` : ''}`;
}

export default async function handler(
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  try {
    const application = await getApplication();
    request.url = publicRequestUrl(request);

    await new Promise<void>((resolve, reject) => {
      const finish = () => {
        cleanup();
        resolve();
      };
      const fail = (error: Error) => {
        cleanup();
        reject(error);
      };
      const cleanup = () => {
        response.off('finish', finish);
        response.off('close', finish);
        response.off('error', fail);
      };

      response.once('finish', finish);
      response.once('close', finish);
      response.once('error', fail);
      application.server.emit('request', request, response);
    });
  } catch (error) {
    console.error('[vercel] request failed', {
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });

    if (!response.headersSent) {
      response.statusCode = 503;
      response.setHeader('content-type', 'application/json; charset=utf-8');
      response.end(JSON.stringify({ error: 'application unavailable' }));
      return;
    }

    response.end();
  }
}
