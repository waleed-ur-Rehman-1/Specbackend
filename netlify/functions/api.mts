import type { Config } from '@netlify/functions';

export default async (request: Request) => {
  // Import lazily so application configuration loads during an invocation.
  const [{ default: serverless }, { default: app }] = await Promise.all([
    import('serverless-http'),
    import('../../src/app.js'),
  ]);
  const url = new URL(request.url);
  const body = Buffer.from(await request.arrayBuffer());
  const handler = serverless(app, { binary: true });
  const result = await handler({
    httpMethod: request.method,
    path: url.pathname,
    headers: Object.fromEntries(request.headers),
    multiValueQueryStringParameters: Object.fromEntries(
      [...new Set(url.searchParams.keys())].map(key => [key, url.searchParams.getAll(key)]),
    ),
    body: body.toString('base64'),
    isBase64Encoded: true,
    requestContext: { identity: {} },
  }, {});
  const headers = new Headers(result.headers);
  for (const [name, values] of Object.entries(result.multiValueHeaders || {})) {
    headers.delete(name);
    for (const value of values as string[]) headers.append(name, value);
  }
  return new Response(
    request.method === 'HEAD' || result.statusCode === 204 || result.statusCode === 304
      ? null
      : result.isBase64Encoded ? Buffer.from(result.body, 'base64') : result.body,
    { status: result.statusCode, headers },
  );
};

export const config: Config = { path: ['/api', '/api/*'] };
