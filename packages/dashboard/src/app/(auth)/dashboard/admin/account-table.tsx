'use client';

import { useState } from 'react';
import { updateAccount } from './actions';
import type { AccountRow } from '@/lib/queries';

const plans = ['free', 'beta', 'pro', 'enterprise', 'admin'] as const;

function AccountRow({ account }: { account: AccountRow }) {
  const [plan, setPlan] = useState(account.plan);
  const [expires, setExpires] = useState(account.plan_expires_at?.slice(0, 10) || '');
  const [note, setNote] = useState(account.note || '');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const dirty =
    plan !== account.plan ||
    expires !== (account.plan_expires_at?.slice(0, 10) || '') ||
    note !== (account.note || '');

  async function save() {
    setSaving(true);
    try {
      await updateAccount(account.user_id, plan, expires || null, note);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to update');
    } finally {
      setSaving(false);
    }
  }

  return (
    <tr className="border-t border-border">
      <td className="px-3 py-3 font-mono text-xs">
        {account.user_id.slice(0, 16)}...
      </td>
      <td className="px-3 py-3">
        <select
          value={plan}
          onChange={(e) => setPlan(e.target.value)}
          className="rounded border border-border bg-secondary px-2 py-1 text-sm"
        >
          {plans.map((p) => (
            <option key={p} value={p}>{p}</option>
          ))}
        </select>
      </td>
      <td className="px-3 py-3">
        <input
          type="date"
          value={expires}
          onChange={(e) => setExpires(e.target.value)}
          placeholder="lifetime"
          className="rounded border border-border bg-secondary px-2 py-1 text-sm"
        />
      </td>
      <td className="px-3 py-3">
        <input
          type="text"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="beta tester, early adopter..."
          className="w-full rounded border border-border bg-secondary px-2 py-1 text-sm"
        />
      </td>
      <td className="px-3 py-3 text-xs text-muted-foreground">
        {new Date(account.created_at).toLocaleDateString()}
      </td>
      <td className="px-3 py-3">
        {dirty && (
          <button
            type="button"
            onClick={save}
            disabled={saving}
            className="rounded bg-primary px-2 py-1 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            {saving ? '...' : saved ? 'Saved' : 'Save'}
          </button>
        )}
        {!dirty && saved && (
          <span className="text-xs text-green-500">Saved</span>
        )}
      </td>
    </tr>
  );
}

export function AccountTable({ accounts }: { accounts: AccountRow[] }) {
  if (!accounts.length) {
    return (
      <p className="text-sm text-muted-foreground">
        No accounts yet. Users get provisioned on first dashboard visit.
      </p>
    );
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      <div className="overflow-x-auto"><table className="w-full text-sm">
        <thead>
          <tr className="bg-secondary text-left text-xs text-muted-foreground">
            <th className="px-3 py-2">User ID</th>
            <th className="px-3 py-2">Plan</th>
            <th className="px-3 py-2">Expires</th>
            <th className="px-3 py-2">Note</th>
            <th className="px-3 py-2">Joined</th>
            <th className="px-3 py-2" />
          </tr>
        </thead>
        <tbody>
          {accounts.map((acc) => (
            <AccountRow key={acc.user_id} account={acc} />
          ))}
        </tbody>
      </table></div>
    </div>
  );
}
