// biome-ignore lint/suspicious/noTsIgnore: The OpenNext handler is generated before Wrangler runs.
// @ts-ignore The OpenNext handler is generated before Wrangler runs.
import openNextHandler from './.open-next/worker.js';
import { classifyRecoveryPath } from './src/lib/public-recovery';

const SECURITY_HEADERS = {
  'Content-Security-Policy':
    "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval' blob: https://*.clerk.com https://*.clerk.accounts.dev; worker-src 'self' blob:; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; font-src 'self' data: https://fonts.gstatic.com; connect-src 'self' https://*.clerk.com https://*.clerk.accounts.dev wss://*.clerk.accounts.dev; frame-src https://*.clerk.com https://*.clerk.accounts.dev; frame-ancestors 'none'",
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Strict-Transport-Security': 'max-age=63072000; includeSubDomains; preload',
  'X-Content-Type-Options': 'nosniff',
  'X-DNS-Prefetch-Control': 'on',
  'X-Frame-Options': 'DENY',
};

const RECOVERY_HEADERS = {
  'Cache-Control': 'no-store',
  'Retry-After': '300',
  'X-Robots-Tag': 'noindex, nofollow',
};

function withHeaders(response: Response, extraHeaders: Record<string, string> = {}): Response {
  const headers = new Headers(response.headers);

  for (const [name, value] of Object.entries({ ...SECURITY_HEADERS, ...extraHeaders })) {
    headers.set(name, value);
  }

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export default {
  async fetch(request: Request, env: unknown, context: unknown): Promise<Response> {
    const requestUrl = new URL(request.url);
    const boundary = classifyRecoveryPath(requestUrl.pathname);

    if (boundary === 'blocked-api') {
      return withHeaders(
        Response.json(
          { error: 'The authenticated LLMKit surface is being restored.' },
          { status: 503 },
        ),
        RECOVERY_HEADERS,
      );
    }

    if (boundary === 'blocked-ui') {
      requestUrl.pathname = '/service-restoring';
      requestUrl.search = '';

      const recoveryPage = await openNextHandler.fetch(
        new Request(requestUrl, request),
        env,
        context,
      );
      const unavailablePage = new Response(recoveryPage.body, {
        status: 503,
        statusText: 'Service Unavailable',
        headers: recoveryPage.headers,
      });

      return withHeaders(unavailablePage, RECOVERY_HEADERS);
    }

    return withHeaders(await openNextHandler.fetch(request, env, context));
  },
};
