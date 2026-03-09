const TELEGRAM_API = 'https://api.telegram.org/bot';

export async function notifyTelegram(
  botToken: string,
  chatId: string,
  text: string,
): Promise<void> {
  try {
    await fetch(`${TELEGRAM_API}${botToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML' }),
    });
  } catch (err) {
    console.error('telegram notify failed:', err);
  }
}

export function formatNewUser(userId: string, keyName: string): string {
  return `🆕 <b>New user on LLMKit</b>\n\nUser: <code>${esc(userId)}</code>\nKey: ${esc(keyName)}`;
}

export function formatErrorStreak(
  userId: string,
  keyPrefix: string,
  errorCode: string,
  model: string,
  provider: string,
  count: number,
): string {
  return `⚠️ <b>User hitting errors</b> (${count}x)\n\nUser: <code>${esc(userId)}</code>\nKey: ${esc(keyPrefix)}\nError: ${esc(errorCode)}\nModel: ${esc(model)}\nProvider: ${esc(provider)}`;
}

export function formatFirstSuccess(userId: string, provider: string, model: string, costDollars: number): string {
  return `✅ <b>First successful request!</b>\n\nUser: <code>${esc(userId)}</code>\nProvider: ${esc(provider)}\nModel: ${esc(model)}\nCost: $${costDollars.toFixed(4)}`;
}

export function formatRequestLog(
  userId: string,
  provider: string,
  model: string,
  inputTokens: number,
  outputTokens: number,
  costDollars: number,
  latencyMs: number,
  errorCode: string | null,
): string {
  const status = errorCode ? `${esc(errorCode)}` : `$${costDollars.toFixed(4)}`;
  const icon = errorCode ? '\u26a0\ufe0f' : '\u2705';
  return `${icon} <code>${esc(userId.slice(-8))}</code> ${esc(provider)}/${esc(model)}\n${inputTokens + outputTokens} tok | ${latencyMs}ms | ${status}`;
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
