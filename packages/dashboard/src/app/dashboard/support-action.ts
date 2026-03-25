'use server';

import { auth } from '@clerk/nextjs/server';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL ?? '',
  process.env.SUPABASE_SERVICE_KEY ?? '',
);

const TG_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TG_CHAT = process.env.TELEGRAM_CHAT_ID;

export async function sendSupportMessage(message: string): Promise<void> {
  const { userId } = await auth();
  if (!userId) throw new Error('Not authenticated');
  if (!message || message.length > 2000) throw new Error('Invalid message');

  // save to supabase (create table if needed via raw insert, RLS bypassed by service key)
  try {
    await supabase.from('support_messages').insert({
      user_id: userId,
      message,
    });
  } catch {
    // table might not exist yet, that's ok, telegram still works
  }

  // send telegram notification
  if (TG_TOKEN && TG_CHAT) {
    const short = userId.slice(0, 16);
    const text = `<b>Support message</b>\n\nFrom: <code>${short}</code>\n\n${escapeHtml(message)}`;
    await fetch(`https://api.telegram.org/bot${TG_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: TG_CHAT, parse_mode: 'HTML', text }),
    }).catch(() => {});
  }
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
