export const dynamic = 'force-dynamic';

import { auth } from '@clerk/nextjs/server';
import { getProviderKeys, getProviderActivity } from '@/lib/queries';
import { ProviderGrid } from './provider-grid';

export default async function ProvidersPage() {
  const { userId } = await auth();
  if (!userId) return null;

  let storedKeys: Awaited<ReturnType<typeof getProviderKeys>> = [];
  let activity: Awaited<ReturnType<typeof getProviderActivity>> = [];
  let connected = true;

  try {
    [storedKeys, activity] = await Promise.all([
      getProviderKeys(userId),
      getProviderActivity(userId),
    ]);
  } catch {
    connected = false;
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Providers</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Your AI provider connections. Keys are encrypted with AES-256-GCM.
        </p>
      </div>
      {connected ? (
        <ProviderGrid storedKeys={storedKeys} activity={activity} />
      ) : (
        <div className="rounded-xl border border-border bg-card p-8 text-center">
          <p className="text-zinc-500">Unable to load data. Please refresh to try again.</p>
        </div>
      )}
    </div>
  );
}
