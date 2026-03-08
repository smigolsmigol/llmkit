import { auth } from '@clerk/nextjs/server';
import { getApiKeys } from '@/lib/queries';
import { formatDate } from '@/lib/format';
import { Badge } from '@/components/ui/badge';
import { CreateKeyForm } from './create-key-form';
import { RevokeKeyButton } from '@/components/revoke-key-button';

export default async function KeysPage() {
  const { userId } = await auth();
  if (!userId) return null;

  let keys: Awaited<ReturnType<typeof getApiKeys>> = [];
  let connected = true;

  try {
    keys = await getApiKeys(userId);
  } catch {
    connected = false;
  }

  if (!connected) {
    return (
      <div className="space-y-6">
        <h1 className="text-xl font-semibold">API Keys</h1>
        <div className="rounded-lg border border-border bg-card p-8 text-center">
          <p className="text-muted-foreground">
            Supabase not connected. Add env vars to .env.local
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">API Keys</h1>
        <CreateKeyForm />
      </div>

      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-muted-foreground">
              <th className="px-4 py-2.5 font-medium">Name</th>
              <th className="px-4 py-2.5 font-medium">Key</th>
              <th className="px-4 py-2.5 font-medium">Created</th>
              <th className="px-4 py-2.5 font-medium">Status</th>
              <th className="px-4 py-2.5 font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {keys.map((key) => {
              const revoked = !!key.revoked_at;
              return (
                <tr key={key.id} className="border-b border-border/50 transition-colors hover:bg-secondary/50">
                  <td className="px-4 py-2.5">{key.name}</td>
                  <td className="px-4 py-2.5 font-mono text-xs text-muted-foreground">
                    {key.key_prefix}...
                  </td>
                  <td className="px-4 py-2.5 text-muted-foreground">{formatDate(key.created_at)}</td>
                  <td className="px-4 py-2.5">
                    <Badge variant={revoked ? 'destructive' : 'success'}>
                      {revoked ? 'Revoked' : 'Active'}
                    </Badge>
                  </td>
                  <td className="px-4 py-2.5">
                    {!revoked && <RevokeKeyButton keyId={key.id} keyName={key.name} />}
                  </td>
                </tr>
              );
            })}
            {keys.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-12 text-center text-muted-foreground">
                  No API keys yet. Create your first key to get started.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
