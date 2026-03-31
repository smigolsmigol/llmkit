'use client';

import { useTransition } from 'react';
import { updateKeyBudget } from '@/app/(auth)/dashboard/keys/actions';

interface Budget {
  id: string;
  name: string;
  limit_cents: number;
  period: string;
}

export function KeyBudgetSelector({ keyId, currentBudgetId, budgets }: {
  keyId: string;
  currentBudgetId: string | null;
  budgets: Budget[];
}) {
  const [pending, startTransition] = useTransition();

  function handleChange(value: string) {
    startTransition(async () => {
      await updateKeyBudget(keyId, value || null);
    });
  }

  return (
    <select
      value={currentBudgetId ?? ''}
      onChange={(e) => handleChange(e.target.value)}
      disabled={pending}
      className="h-7 rounded border border-border bg-secondary px-2 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-ring disabled:opacity-50"
    >
      <option value="">None</option>
      {budgets.map((b) => (
        <option key={b.id} value={b.id}>
          {b.name} (${(b.limit_cents / 100).toFixed(2)}/{b.period})
        </option>
      ))}
    </select>
  );
}
