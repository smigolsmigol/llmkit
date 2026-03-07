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

function ProviderCard({
  provider,
  stored,
}: {
  provider: (typeof ALL_PROVIDERS)[number];
  stored: ProviderKeyRow | null;
}) {
  const router = useRouter();
  const [revoking, setRevoking] = useState(false);

  async function handleRevoke() {
    if (!stored) return;
    setRevoking(true);
    try {
      await revokeProviderKey(stored.id);
      router.refresh();
    } catch {
      alert('Failed to revoke');
    } finally {
      setRevoking(false);
    }
  }

  const connected = !!stored;

  return (
    <div className={`rounded-lg border p-4 ${connected ? 'border-green-500/30 bg-green-500/5' : 'border-border bg-card'}`}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className={`h-2.5 w-2.5 rounded-full ${connected ? 'bg-green-500' : 'bg-muted-foreground/30'}`} />
          <span className="font-medium text-sm">{provider.name}</span>
        </div>
        {connected && (
          <span className="font-mono text-xs text-muted-foreground">{stored.key_prefix}</span>
        )}
      </div>

      {connected ? (
        <div className="mt-3 flex items-center justify-between">
          <span className="text-xs text-green-500">Connected</span>
          <button
            type="button"
            onClick={handleRevoke}
            disabled={revoking}
            className="text-xs text-red-400 hover:text-red-300 disabled:opacity-50"
          >
            {revoking ? '...' : 'Disconnect'}
          </button>
        </div>
      ) : (
        <p className="mt-3 text-xs text-muted-foreground">
          {provider.hint ? `Key format: ${provider.hint}` : 'Not connected'}
        </p>
      )}
    </div>
  );
}

export function ProviderGrid({ storedKeys }: { storedKeys: ProviderKeyRow[] }) {
  const keysByProvider = new Map(storedKeys.map((k) => [k.provider, k]));
  const connectedCount = storedKeys.length;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-4">
        <span className="text-sm text-muted-foreground">
          {connectedCount} of {ALL_PROVIDERS.length} providers connected
        </span>
      </div>

      <div className="grid grid-cols-3 gap-3">
        {ALL_PROVIDERS.map((p) => (
          <ProviderCard key={p.id} provider={p} stored={keysByProvider.get(p.id) || null} />
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
