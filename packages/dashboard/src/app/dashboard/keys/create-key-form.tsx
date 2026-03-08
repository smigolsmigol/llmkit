'use client';

import { useState } from 'react';
import { createApiKey } from './actions';

const PROXY_URL = 'https://llmkit-proxy.smigolsmigol.workers.dev/v1';

function SnippetBlock({ label, code, onCopy }: { label: string; code: string; onCopy: (text: string) => void }) {
  return (
    <div>
      <p className="mb-1 text-xs font-medium text-muted-foreground">{label}</p>
      <div className="group relative rounded-md bg-secondary p-3">
        <pre className="overflow-x-auto font-mono text-xs text-primary whitespace-pre">{code}</pre>
        <button
          type="button"
          onClick={() => onCopy(code)}
          className="absolute right-2 top-2 rounded border border-border bg-card px-1.5 py-0.5 text-[10px] text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 hover:text-primary"
        >
          copy
        </button>
      </div>
    </div>
  );
}

export function CreateKeyForm() {
  const [open, setOpen] = useState(false);
  const [newKey, setNewKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [name, setName] = useState('');
  const [copied, setCopied] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;

    setPending(true);
    setError(null);
    try {
      const result = await createApiKey(name.trim());
      setNewKey(result.key);
      setName('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create key');
    } finally {
      setPending(false);
    }
  }

  function handleClose() {
    setOpen(false);
    setNewKey(null);
    setError(null);
    setName('');
    setCopied(false);
  }

  function copyText(text: string) {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  if (newKey) {
    const pythonSnippet = `from openai import OpenAI

client = OpenAI(
    base_url="${PROXY_URL}",
    api_key="${newKey}",
    default_headers={"x-llmkit-provider-key": "sk-your-openai-key"},
)

res = client.chat.completions.create(
    model="gpt-4o",
    messages=[{"role": "user", "content": "hello"}],
)
print(res.choices[0].message.content)`;

    const cliSnippet = `LLMKIT_KEY=${newKey} npx @f3d1/llmkit-cli -- python your_app.py`;

    const envSnippet = `export OPENAI_BASE_URL=${PROXY_URL}
export OPENAI_API_KEY=${newKey}
python your_app.py`;

    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
        <div className="mx-4 w-full max-w-lg rounded-lg border border-border bg-card p-6">
          <h2 className="text-lg font-semibold">Key Created</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Save this key now. You won&apos;t see it again.
          </p>

          <div className="mt-3 rounded-md bg-secondary p-3">
            <code className="break-all font-mono text-xs text-primary">{newKey}</code>
          </div>

          <div className="mt-2 flex gap-2">
            <button
              type="button"
              onClick={() => copyText(newKey)}
              className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90"
            >
              {copied ? 'Copied' : 'Copy Key'}
            </button>
          </div>

          <div className="mt-5 border-t border-border pt-4">
            <h3 className="text-sm font-semibold">Quick start</h3>
            <p className="mt-1 text-xs text-muted-foreground">
              Replace <code className="rounded bg-secondary px-1">sk-your-openai-key</code> with your actual provider key.
            </p>

            <div className="mt-3 space-y-3">
              <SnippetBlock label="CLI (any language, zero code changes)" code={cliSnippet} onCopy={copyText} />
              <SnippetBlock label="Env vars (Python/Node)" code={envSnippet} onCopy={copyText} />
              <SnippetBlock label="Python (explicit)" code={pythonSnippet} onCopy={copyText} />
            </div>
          </div>

          <div className="mt-5 flex justify-end">
            <button
              type="button"
              onClick={handleClose}
              className="rounded-md border border-border px-3 py-1.5 text-sm hover:bg-secondary"
            >
              Done
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90"
      >
        Create Key
      </button>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="mx-4 w-full max-w-md rounded-lg border border-border bg-card p-6">
        <h2 className="text-lg font-semibold">Create API Key</h2>
        <form onSubmit={handleSubmit} className="mt-4 space-y-4">
          <div>
            <label htmlFor="key-name" className="mb-1.5 block text-sm text-muted-foreground">
              Key Name
            </label>
            <input
              id="key-name"
              type="text"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Production, Development"
              className="w-full rounded-md border border-border bg-secondary px-3 py-2 text-sm placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
            />
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={handleClose}
              className="rounded-md border border-border px-3 py-1.5 text-sm hover:bg-secondary"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={pending}
              className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              {pending ? 'Creating...' : 'Create'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
