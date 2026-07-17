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

export type RecoveryBoundary = 'public' | 'blocked-ui' | 'blocked-api';

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
