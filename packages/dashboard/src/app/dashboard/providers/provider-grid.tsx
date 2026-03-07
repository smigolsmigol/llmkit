'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { addProviderKey, revokeProviderKey } from './actions';
import { formatCents } from '@/lib/format';
import type { ProviderKeyRow, ProviderActivity } from '@/lib/queries';

const ALL_PROVIDERS = [
  { id: 'openai', name: 'OpenAI' },
  { id: 'anthropic', name: 'Anthropic' },
  { id: 'gemini', name: 'Google Gemini' },
  { id: 'groq', name: 'Groq' },
  { id: 'together', name: 'Together' },
  { id: 'fireworks', name: 'Fireworks' },
  { id: 'deepseek', name: 'DeepSeek' },
  { id: 'mistral', name: 'Mistral' },
  { id: 'xai', name: 'xAI (Grok)' },
  { id: 'ollama', name: 'Ollama' },
  { id: 'openrouter', name: 'OpenRouter' },
] as const;

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

function ActiveProviderCard({
  provider,
  activity,
  keys,
}: {
  provider: (typeof ALL_PROVIDERS)[number];
  activity: ProviderActivity;
  keys: ProviderKeyRow[];
}) {
  const router = useRouter();
  const [revoking, setRevoking] = useState<string | null>(null);
  const [showAddKey, setShowAddKey] = useState(false);

  async function handleRevoke(keyId: string) {
    setRevoking(keyId);
    try {
      await revokeProviderKey(keyId);
      router.refresh();
    } catch {
      alert('Failed to revoke');
    } finally {
      setRevoking(null);
    }
  }

  const hasRecentError = activity.lastErrorTime &&
    (Date.now() - new Date(activity.lastErrorTime).getTime()) < 3600000;

  return (
    <div className="rounded-lg border border-green-500/30 bg-card p-4">
      {/* header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className={`h-2.5 w-2.5 rounded-full ${hasRecentError ? 'bg-yellow-500' : 'bg-green-500'}`} />
          <span className="text-sm font-medium">{provider.name}</span>
        </div>
        <span className="text-xs text-muted-foreground">{timeAgo(activity.lastUsed)}</span>
      </div>

      {/* stats */}
      <div className="mt-3 flex gap-4 text-xs">
        <span className="text-muted-foreground">
          {activity.requests} req{activity.requests !== 1 ? 's' : ''}
        </span>
        <span className="font-mono text-muted-foreground">{formatCents(activity.spendCents)}</span>
        {hasRecentError && (
          <span className="text-yellow-500">{activity.lastError}</span>
        )}
      </div>

      {/* models */}
      <div className="mt-2 flex flex-wrap gap-1">
        {activity.models.slice(0, 4).map((m) => (
          <span key={m.model} className="rounded bg-secondary px-1.5 py-0.5 text-[10px] text-muted-foreground">
            {m.model} ({m.count})
          </span>
        ))}
        {activity.models.length > 4 && (
          <span className="text-[10px] text-muted-foreground">+{activity.models.length - 4} more</span>
        )}
      </div>

      {/* stored keys */}
      {keys.length > 0 && (
        <div className="mt-3 border-t border-border/30 pt-2">
          <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground/60">
            Stored keys ({keys.length})
          </p>
          {keys.map((k) => (
            <div key={k.id} className="flex items-center justify-between py-1">
              <div className="flex items-center gap-2">
                <span className="font-mono text-xs text-muted-foreground">{k.key_prefix}</span>
                {k.key_name !== 'default' && (
                  <span className="text-[10px] text-muted-foreground/50">({k.key_name})</span>
                )}
              </div>
              <button
                type="button"
                onClick={() => handleRevoke(k.id)}
                disabled={revoking === k.id}
                className="text-[10px] text-red-400 hover:text-red-300 disabled:opacity-50"
              >
                {revoking === k.id ? '...' : 'remove'}
              </button>
            </div>
          ))}
        </div>
      )}

      {/* add key */}
      {showAddKey ? (
        <AddKeyInline provider={provider.id} onDone={() => { setShowAddKey(false); router.refresh(); }} />
      ) : (
        <button
          type="button"
          onClick={() => setShowAddKey(true)}
          className="mt-2 text-xs text-primary hover:text-primary/80"
        >
          + Add key
        </button>
      )}
    </div>
  );
}

function AddKeyInline({ provider, onDone }: { provider: string; onDone: () => void }) {
  const [key, setKey] = useState('');
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      await addProviderKey(provider, key, name || undefined);
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add key');
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="mt-2 space-y-2 border-t border-border/30 pt-2">
      <input
        type="password"
        value={key}
        onChange={(e) => setKey(e.target.value)}
        placeholder="Paste API key"
        className="w-full rounded border border-border bg-secondary px-2 py-1 text-xs"
        autoFocus
      />
      <input
        type="text"
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Label (optional)"
        className="w-full rounded border border-border bg-secondary px-2 py-1 text-xs"
      />
      {error && <p className="text-xs text-red-400">{error}</p>}
      <div className="flex gap-2">
        <button
          type="submit"
          disabled={saving || key.length < 8}
          className="rounded bg-primary px-2 py-1 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
        >
          {saving ? 'Saving...' : 'Save'}
        </button>
        <button
          type="button"
          onClick={onDone}
          className="text-xs text-muted-foreground hover:text-foreground"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}

function InactiveProviderCard({ provider }: { provider: (typeof ALL_PROVIDERS)[number] }) {
  const router = useRouter();
  const [showAddKey, setShowAddKey] = useState(false);

  return (
    <div className="rounded-lg border border-border bg-card p-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="h-2 w-2 rounded-full bg-muted-foreground/30" />
          <span className="text-sm text-muted-foreground">{provider.name}</span>
        </div>
      </div>
      {showAddKey ? (
        <AddKeyInline provider={provider.id} onDone={() => { setShowAddKey(false); router.refresh(); }} />
      ) : (
        <button
          type="button"
          onClick={() => setShowAddKey(true)}
          className="mt-2 text-xs text-primary/60 hover:text-primary"
        >
          + Add key
        </button>
      )}
    </div>
  );
}

export function ProviderGrid({
  storedKeys,
  activity,
}: {
  storedKeys: ProviderKeyRow[];
  activity: ProviderActivity[];
}) {
  const keysByProvider = new Map<string, ProviderKeyRow[]>();
  for (const k of storedKeys) {
    const existing = keysByProvider.get(k.provider) || [];
    existing.push(k);
    keysByProvider.set(k.provider, existing);
  }

  const activityMap = new Map(activity.map((a) => [a.provider, a]));

  // active = has usage OR has stored keys
  const activeIds = new Set([
    ...activity.map((a) => a.provider),
    ...storedKeys.map((k) => k.provider),
  ]);

  const activeProviders = ALL_PROVIDERS.filter((p) => activeIds.has(p.id));
  const inactiveProviders = ALL_PROVIDERS.filter((p) => !activeIds.has(p.id));

  return (
    <div className="space-y-6">
      {activeProviders.length > 0 && (
        <div>
          <h2 className="mb-3 text-sm font-medium text-muted-foreground">
            Active ({activeProviders.length})
          </h2>
          <div className="grid grid-cols-2 gap-3">
            {activeProviders.map((p) => (
              <ActiveProviderCard
                key={p.id}
                provider={p}
                activity={activityMap.get(p.id) || {
                  provider: p.id, requests: 0, spendCents: 0,
                  lastUsed: '', lastError: null, lastErrorTime: null, models: [],
                }}
                keys={keysByProvider.get(p.id) || []}
              />
            ))}
          </div>
        </div>
      )}

      {inactiveProviders.length > 0 && (
        <div>
          <h2 className="mb-3 text-sm font-medium text-muted-foreground">
            Available ({inactiveProviders.length})
          </h2>
          <div className="grid grid-cols-4 gap-3">
            {inactiveProviders.map((p) => (
              <InactiveProviderCard key={p.id} provider={p} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
