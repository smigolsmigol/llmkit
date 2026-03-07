'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { revokeProviderKey } from './actions';
import type { ProviderKeyRow } from '@/lib/queries';

const ALL_PROVIDERS = [
  { id: 'openai', name: 'OpenAI', hint: 'sk-...' },
  { id: 'anthropic', name: 'Anthropic', hint: 'sk-ant-...' },
  { id: 'gemini', name: 'Google Gemini', hint: 'AIza...' },
  { id: 'groq', name: 'Groq', hint: 'gsk_...' },
  { id: 'together', name: 'Together', hint: '' },
  { id: 'fireworks', name: 'Fireworks', hint: '' },
  { id: 'deepseek', name: 'DeepSeek', hint: 'sk-...' },
  { id: 'mistral', name: 'Mistral', hint: '' },
  { id: 'xai', name: 'xAI (Grok)', hint: 'xai-...' },
  { id: 'ollama', name: 'Ollama', hint: 'local' },
  { id: 'openrouter', name: 'OpenRouter', hint: 'sk-or-...' },
] as const;

function KeyRow({ k, onRevoke }: { k: ProviderKeyRow; onRevoke: (id: string) => void }) {
  const [revoking, setRevoking] = useState(false);

  async function handleRevoke() {
    setRevoking(true);
    try {
      await onRevoke(k.id);
    } finally {
      setRevoking(false);
    }
  }

  return (
    <div className="flex items-center justify-between border-t border-border/30 py-2 first:border-0 first:pt-0">
      <div className="flex items-center gap-2">
        <span className="font-mono text-xs text-muted-foreground">{k.key_prefix}</span>
        {k.key_name !== 'default' && (
          <span className="text-xs text-muted-foreground/60">({k.key_name})</span>
        )}
      </div>
      <button
        type="button"
        onClick={handleRevoke}
        disabled={revoking}
        className="text-xs text-red-400 hover:text-red-300 disabled:opacity-50"
      >
        {revoking ? '...' : 'Disconnect'}
      </button>
    </div>
  );
}

function ProviderCard({
  provider,
  keys,
}: {
  provider: (typeof ALL_PROVIDERS)[number];
  keys: ProviderKeyRow[];
}) {
  const router = useRouter();
  const [expanded, setExpanded] = useState(false);
  const connected = keys.length > 0;

  async function handleRevoke(keyId: string) {
    try {
      await revokeProviderKey(keyId);
      router.refresh();
    } catch {
      alert('Failed to revoke');
    }
  }

  return (
    <div className={`rounded-lg border p-4 ${connected ? 'border-green-500/30 bg-green-500/5' : 'border-border bg-card'}`}>
      <button
        type="button"
        onClick={() => connected && setExpanded(!expanded)}
        className="flex w-full items-center justify-between text-left"
      >
        <div className="flex items-center gap-3">
          <div className={`h-2.5 w-2.5 rounded-full ${connected ? 'bg-green-500' : 'bg-muted-foreground/30'}`} />
          <span className="text-sm font-medium">{provider.name}</span>
        </div>
        {connected ? (
          <span className="text-xs text-green-500">
            {keys.length} key{keys.length !== 1 ? 's' : ''}
            {keys.length > 1 ? (expanded ? ' ▴' : ' ▾') : ''}
          </span>
        ) : (
          <span className="text-xs text-muted-foreground">
            {provider.hint ? provider.hint : 'not connected'}
          </span>
        )}
      </button>

      {connected && (keys.length === 1 || expanded) && (
        <div className="mt-3 space-y-0">
          {keys.map((k) => (
            <KeyRow key={k.id} k={k} onRevoke={handleRevoke} />
          ))}
        </div>
      )}
    </div>
  );
}

export function ProviderGrid({ storedKeys }: { storedKeys: ProviderKeyRow[] }) {
  const keysByProvider = new Map<string, ProviderKeyRow[]>();
  for (const k of storedKeys) {
    const existing = keysByProvider.get(k.provider) || [];
    existing.push(k);
    keysByProvider.set(k.provider, existing);
  }

  const connectedProviders = new Set(storedKeys.map((k) => k.provider));

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-4">
        <span className="text-sm text-muted-foreground">
          {connectedProviders.size} of {ALL_PROVIDERS.length} providers connected
          {storedKeys.length > connectedProviders.size && ` (${storedKeys.length} keys total)`}
        </span>
      </div>

      <div className="grid grid-cols-3 gap-3">
        {ALL_PROVIDERS.map((p) => (
          <ProviderCard key={p.id} provider={p} keys={keysByProvider.get(p.id) || []} />
        ))}
      </div>

      <div className="rounded-lg border border-border bg-card p-4">
        <p className="text-sm font-medium">Adding provider keys</p>
        <p className="mt-1 text-xs text-muted-foreground">
          Store keys via the API so you don't have to pass them with every request.
          Keys are encrypted with AES-256-GCM before storage.
        </p>
        <pre className="mt-3 overflow-x-auto rounded bg-secondary p-3 text-xs">
{`curl -X POST https://llmkit-proxy.smigolsmigol.workers.dev/v1/provider-keys \\
  -H "Authorization: Bearer llmk_YOUR_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"provider": "openai", "key": "sk-YOUR_OPENAI_KEY"}'`}
        </pre>
        <p className="mt-2 text-xs text-muted-foreground">
          Or pass the key per-request with the x-llmkit-provider-key header.
        </p>
      </div>
    </div>
  );
}
