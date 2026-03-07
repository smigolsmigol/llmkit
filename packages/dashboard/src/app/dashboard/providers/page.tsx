import { auth } from '@clerk/nextjs/server';
import { getProviderKeys, getProviderActivity } from '@/lib/queries';
import { ProviderGrid } from './provider-grid';

export default async function ProvidersPage() {
  const { userId } = await auth();
  if (!userId) return null;

  const [storedKeys, activity] = await Promise.all([
    getProviderKeys(userId),
    getProviderActivity(userId),
  ]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Providers</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Your AI provider connections. Keys are encrypted with AES-256-GCM.
        </p>
      </div>
      <ProviderGrid storedKeys={storedKeys} activity={activity} />
    </div>
  );
}
