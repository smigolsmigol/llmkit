'use server';

import { auth } from '@clerk/nextjs/server';
import { createServerClient } from '@/lib/supabase';

const supabase = createServerClient();

const TG_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TG_CHAT = process.env.TELEGRAM_CHAT_ID;

// simple in-memory rate limit: max 3 messages per user per hour
const recentMessages = new Map<string, number[]>();

function checkRateLimit(userId: string): boolean {
  const now = Date.now();
  const hourAgo = now - 3600000;
  const timestamps = (recentMessages.get(userId) ?? []).filter(t => t > hourAgo);
  if (timestamps.length >= 3) return false;
  timestamps.push(now);
  recentMessages.set(userId, timestamps);
  return true;
}

export async function sendSupportMessage(message: string): Promise<void> {
  const { userId } = await auth();
  if (!userId) throw new Error('Not authenticated');
  if (!message || message.length > 2000) throw new Error('Invalid message');
  if (!checkRateLimit(userId)) throw new Error('Too many messages. Please wait before sending another.');

  try {
    await supabase.from('support_messages').insert({
      user_id: userId,
      message,
    });
  } catch {
    // table might not exist yet, telegram still works
  }

  if (TG_TOKEN && TG_CHAT) {
    const short = escapeHtml(userId.slice(0, 16));
    const text = `<b>Support message</b>\n\nFrom: <code>${short}</code>\n\n${escapeHtml(message)}`;
    await fetch(`https://api.telegram.org/bot${TG_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: TG_CHAT, parse_mode: 'HTML', text }),
    }).catch(() => {});
  }
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
