'use client';

import { useState, useTransition } from 'react';
import { createApiKey } from '@/app/dashboard/keys/actions';
import { Button } from '@/components/ui/button';

export function CreateKeyDialog() {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [newKey, setNewKey] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handleCreate() {
    if (!name.trim()) return;
    setError(null);
    startTransition(async () => {
      try {
        const result = await createApiKey(name.trim());
        setNewKey(result.key);
        setName('');
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to create key');
      }
    });
  }

  function handleCopy() {
    if (!newKey) return;
    navigator.clipboard.writeText(newKey);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  function handleClose() {
    setOpen(false);
    setNewKey(null);
    setName('');
    setError(null);
    setCopied(false);
  }

  if (!open) {
    return (
      <Button size="sm" onClick={() => setOpen(true)}>
        Create Key
      </Button>
    );
  }

  return (
    <>
      {/* backdrop */}
      <div className="fixed inset-0 z-40 bg-black/60" onClick={handleClose} />

      {/* dialog */}
      <div className="fixed left-1/2 top-1/2 z-50 w-full max-w-md -translate-x-1/2 -translate-y-1/2 rounded-lg border border-border bg-card p-6">
        {newKey ? (
          <div className="space-y-4">
            <h2 className="text-lg font-semibold">Key Created</h2>
            <p className="text-sm text-muted-foreground">
              Copy this key now. You won't be able to see it again.
            </p>
            <div className="flex items-center gap-2 rounded-md border border-border bg-background p-3">
              <code className="flex-1 break-all font-mono text-xs text-primary">{newKey}</code>
              <button
                onClick={handleCopy}
                className="shrink-0 rounded px-2 py-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
              >
                {copied ? 'Copied!' : 'Copy'}
              </button>
            </div>
            <div className="flex justify-end">
              <Button variant="secondary" size="sm" onClick={handleClose}>
                Done
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <h2 className="text-lg font-semibold">Create API Key</h2>
            <div>
              <label className="mb-1.5 block text-sm text-muted-foreground">Name</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Production, Development"
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
                autoFocus
              />
            </div>
            {error && <p className="text-sm text-red-400">{error}</p>}
            <div className="flex justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={handleClose}>Cancel</Button>
              <Button size="sm" onClick={handleCreate} disabled={pending || !name.trim()}>
                {pending ? 'Creating...' : 'Create'}
              </Button>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
