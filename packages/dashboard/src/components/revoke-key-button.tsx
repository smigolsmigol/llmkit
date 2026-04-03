'use client';

import { useState, useTransition } from 'react';
import { revokeApiKey } from '@/app/(auth)/dashboard/keys/actions';

interface RevokeKeyButtonProps {
  keyId: string;
  keyName: string;
}

export function RevokeKeyButton({ keyId, keyName }: RevokeKeyButtonProps) {
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState(false);
  const [pending, startTransition] = useTransition();

  function handleRevoke() {
    setError(false);
    startTransition(async () => {
      try {
        await revokeApiKey(keyId);
        setConfirming(false);
      } catch {
        setError(true);
      }
    });
  }

  if (confirming) {
    return (
      <span className="flex items-center gap-1.5">
        {error && <span className="text-xs text-red-400">Failed.</span>}
        <span className="text-xs text-muted-foreground">Revoke {keyName}?</span>
        <button
          onClick={handleRevoke}
          disabled={pending}
          className="rounded px-2 py-0.5 text-xs text-red-400 transition-colors hover:bg-red-500/10"
        >
          {pending ? '...' : 'Yes'}
        </button>
        <button
          onClick={() => setConfirming(false)}
          className="rounded px-2 py-0.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
        >
          No
        </button>
      </span>
    );
  }

  return (
    <button
      onClick={() => setConfirming(true)}
      className="rounded px-2 py-0.5 text-xs text-muted-foreground transition-colors hover:text-red-400"
    >
      Revoke
    </button>
  );
}
