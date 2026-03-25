'use client';

import { useState, useTransition } from 'react';
import { sendSupportMessage } from '@/app/dashboard/support-action';

export function SupportWidget() {
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState('');
  const [sent, setSent] = useState(false);
  const [error, setError] = useState('');
  const [pending, startTransition] = useTransition();

  function handleSend() {
    if (!message.trim() || pending) return;
    setError('');
    startTransition(async () => {
      try {
        await sendSupportMessage(message.trim());
        setSent(true);
        setMessage('');
        setTimeout(() => {
          setSent(false);
          setOpen(false);
        }, 3000);
      } catch {
        setError('Failed to send. Try again.');
      }
    });
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="fixed bottom-5 right-5 z-50 flex h-12 w-12 items-center justify-center rounded-full bg-violet-600 text-white shadow-lg shadow-violet-600/20 transition hover:bg-violet-500 hover:scale-105"
        title="Need help?"
      >
        <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
        </svg>
      </button>
    );
  }

  return (
    <div className="fixed bottom-5 right-5 z-50 w-80 rounded-xl border border-white/[0.08] bg-[#111] shadow-2xl shadow-black/40">
      <div className="flex items-center justify-between border-b border-white/[0.06] px-4 py-3">
        <div>
          <p className="text-sm font-medium text-white">Support</p>
          <p className="text-[10px] text-zinc-500">We usually reply within a few hours</p>
        </div>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="text-zinc-500 hover:text-white transition"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>

      <div className="p-4">
        {sent ? (
          <div className="py-6 text-center">
            <div className="mb-2 inline-flex h-10 w-10 items-center justify-center rounded-full bg-emerald-500/10">
              <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-emerald-400">
                <polyline points="20 6 9 17 4 12" />
              </svg>
            </div>
            <p className="text-sm text-zinc-300">Message sent</p>
            <p className="mt-1 text-xs text-zinc-500">We will get back to you soon.</p>
          </div>
        ) : (
          <>
            <textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="Describe your issue or question..."
              rows={4}
              className="w-full resize-none rounded-lg border border-white/[0.06] bg-white/[0.02] px-3 py-2 text-sm text-white placeholder:text-zinc-600 focus:border-violet-500/30 focus:outline-none"
            />
            {error && <p className="mt-1 text-xs text-red-400">{error}</p>}
            <button
              type="button"
              onClick={handleSend}
              disabled={pending || !message.trim()}
              className="mt-2 w-full rounded-lg bg-violet-600 py-2 text-sm font-medium text-white transition hover:bg-violet-500 disabled:opacity-50"
            >
              {pending ? 'Sending...' : 'Send message'}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
