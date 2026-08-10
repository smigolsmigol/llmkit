export const RECOVERY_BLOCKED_UI_PREFIXES = [
  '/dashboard',
  '/sign-in',
  '/sign-up',
] as const;

export const RECOVERY_BLOCKED_API_PREFIXES = [
  '/api/analytics',
  '/api/export',
  '/api/pricing',
] as const;

export const RECOVERY_WEB_HOSTS = ['llmkit.sh', 'www.llmkit.sh'] as const;

export const RECOVERY_PUBLIC_CTA = {
  href: '/docs#local-setup',
  label: 'Use locally',
} as const;

export const RECOVERY_STATUS_HREF = '/service-restoring';

export type RecoveryBoundary = 'public' | 'blocked-ui' | 'blocked-api';

export function getWorkerVersionHeaders(environment: unknown): Record<string, string> {
  if (!environment || typeof environment !== 'object') {
    return {};
  }

  const metadata = Reflect.get(environment, 'CF_VERSION_METADATA');
  if (!metadata || typeof metadata !== 'object') {
    return {};
  }

  const versionId = Reflect.get(metadata, 'id');
  return typeof versionId === 'string' && versionId.length > 0
    ? { 'X-LLMKit-Worker-Version': versionId }
    : {};
}

export function getHttpsRedirectUrl(requestUrl: URL): string | null {
  if (
    requestUrl.protocol !== 'http:' ||
    !RECOVERY_WEB_HOSTS.some((hostname) => hostname === requestUrl.hostname)
  ) {
    return null;
  }

  return `https://${requestUrl.hostname}${requestUrl.pathname}${requestUrl.search}`;
}

export function createHttpsRedirectResponse(requestUrl: URL): Response | null {
  const location = getHttpsRedirectUrl(requestUrl);

  if (!location) {
    return null;
  }

  return new Response(null, {
    status: 308,
    headers: { Location: location },
  });
}

function matchesPathPrefix(pathname: string, prefix: string): boolean {
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

export function classifyRecoveryPath(pathname: string): RecoveryBoundary {
  if (RECOVERY_BLOCKED_API_PREFIXES.some((prefix) => matchesPathPrefix(pathname, prefix))) {
    return 'blocked-api';
  }

  if (RECOVERY_BLOCKED_UI_PREFIXES.some((prefix) => matchesPathPrefix(pathname, prefix))) {
    return 'blocked-ui';
  }

  return 'public';
}
