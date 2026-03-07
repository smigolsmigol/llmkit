import { auth } from '@clerk/nextjs/server';
import { getProviderKeys } from '@/lib/queries';
import { ProviderGrid } from './provider-grid';

export default async function ProvidersPage() {
  const { userId } = await auth();
  if (!userId) return null;

  const storedKeys = await getProviderKeys(userId);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Providers</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Store your provider API keys so you don't have to send them with every request.
          Keys are encrypted with AES-256-GCM before storage.
        </p>
      </div>
      <ProviderGrid storedKeys={storedKeys} />
    </div>
  );
}
