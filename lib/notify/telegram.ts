// Send-only Telegram push, like the Tasks and Life OS bots. Uses its own bot: TELEGRAM_BOT_TOKEN
// from @BotFather and TELEGRAM_CHAT_ID (the chat that may receive alerts).
export type SendResult = { ok: true } | { ok: false; error: string };

export function telegramConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(env.TELEGRAM_BOT_TOKEN && env.TELEGRAM_CHAT_ID);
}

/** Sends an HTML-formatted message. Never throws: a notification must not break the job that raised it. */
export async function sendTelegram(html: string, env: NodeJS.ProcessEnv = process.env, fetchImpl: typeof fetch = fetch): Promise<SendResult> {
  const token = env.TELEGRAM_BOT_TOKEN;
  const chatId = env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) return { ok: false, error: 'TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID is not set' };
  try {
    const res = await fetchImpl(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text: html, parse_mode: 'HTML', disable_web_page_preview: true }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      // The URL contains the token, so report only Telegram's own description.
      const body = (await res.json().catch(() => null)) as { description?: string } | null;
      return { ok: false, error: `Telegram ${res.status}${body?.description ? `: ${body.description}` : ''}` };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.name : 'request failed' };
  }
}
