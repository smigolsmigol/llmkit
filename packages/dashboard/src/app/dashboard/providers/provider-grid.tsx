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

function ConnectedCard({
  provider,
  keys,
}: {
  provider: (typeof ALL_PROVIDERS)[number];
  keys: ProviderKeyRow[];
}) {
  const router = useRouter();
  const [revoking, setRevoking] = useState<string | null>(null);

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

  return (
    <div className="rounded-lg border border-green-500/30 bg-green-500/5 p-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="h-2.5 w-2.5 rounded-full bg-green-500" />
          <span className="text-sm font-medium">{provider.name}</span>
        </div>
        <span className="text-xs text-green-500">
          {keys.length} key{keys.length !== 1 ? 's' : ''}
        </span>
      </div>

      <div className="mt-3 space-y-0">
        {keys.map((k) => (
          <div
            key={k.id}
            className="flex items-center justify-between border-t border-green-500/10 py-2 first:border-0 first:pt-0"
          >
            <div className="flex items-center gap-2">
              <span className="font-mono text-xs text-muted-foreground">{k.key_prefix}</span>
              {k.key_name !== 'default' && (
                <span className="text-xs text-muted-foreground/60">({k.key_name})</span>
              )}
            </div>
            <button
              type="button"
              onClick={() => handleRevoke(k.id)}
              disabled={revoking === k.id}
              className="text-xs text-red-400 hover:text-red-300 disabled:opacity-50"
            >
              {revoking === k.id ? '...' : 'Disconnect'}
            </button>
          </div>
        ))}
      </div>
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

  const connectedIds = new Set(storedKeys.map((k) => k.provider));
  const connected = ALL_PROVIDERS.filter((p) => connectedIds.has(p.id));
  const notConnected = ALL_PROVIDERS.filter((p) => !connectedIds.has(p.id));

  return (
    <div className="space-y-6">
      {connected.length > 0 && (
        <div>
          <h2 className="mb-3 text-sm font-medium text-muted-foreground">
            Connected ({connected.length})
          </h2>
          <div className="grid grid-cols-3 gap-3">
            {connected.map((p) => (
              <ConnectedCard key={p.id} provider={p} keys={keysByProvider.get(p.id)!} />
            ))}
          </div>
        </div>
      )}

      {notConnected.length > 0 && (
        <div>
          <h2 className="mb-3 text-sm font-medium text-muted-foreground">
            Available ({notConnected.length})
          </h2>
          <div className="grid grid-cols-4 gap-3">
            {notConnected.map((p) => (
              <div key={p.id} className="rounded-lg border border-border bg-card p-3">
                <div className="flex items-center gap-2">
                  <div className="h-2 w-2 rounded-full bg-muted-foreground/30" />
                  <span className="text-sm text-muted-foreground">{p.name}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

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
