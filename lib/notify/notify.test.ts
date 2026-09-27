import { describe, expect, it, vi } from 'vitest';
import { escapeHtml, jobFailureMessage, meetsThreshold, signalAlertMessage } from './format';
import { sendTelegram, telegramConfigured } from './telegram';

const alert = { id: 'abc', ticker: 'ACME', issuer: 'Acme <Corp> & Sons', insiderCount: 4, totalValue: 1_250_000, baselineScore: 71.4, agentScore: 82, conviction: 'high' };

describe('messages', () => {
  it('escapes HTML from filing-derived text', () => {
    expect(escapeHtml('<b>&')).toBe('&lt;b&gt;&amp;');
    expect(signalAlertMessage(alert, undefined)).toContain('Acme &lt;Corp&gt; &amp; Sons');
    expect(jobFailureMessage('score-agent', '<boom>')).toContain('&lt;boom&gt;');
  });

  it('includes scores and a link only when a base URL is known', () => {
    const m = signalAlertMessage(alert, 'https://x.example/');
    expect(m).toContain('4 insiders bought $1,250,000');
    expect(m).toContain('baseline 71 · agent 82 (high)');
    expect(m).toContain('https://x.example/signals/abc');
    expect(signalAlertMessage(alert, undefined)).not.toContain('http');
  });

  it('truncates long errors', () => {
    expect(jobFailureMessage('j', 'x'.repeat(2000)).length).toBeLessThan(700);
  });

  it('threshold applies to either score', () => {
    expect(meetsThreshold({ baselineScore: 60, agentScore: 70 }, 70)).toBe(true);
    expect(meetsThreshold({ baselineScore: 70, agentScore: null }, 70)).toBe(true);
    expect(meetsThreshold({ baselineScore: 69.9, agentScore: null }, 70)).toBe(false);
    expect(meetsThreshold({ baselineScore: null, agentScore: null }, 0)).toBe(false);
  });
});

describe('sendTelegram', () => {
  const env = { TELEGRAM_BOT_TOKEN: 'SECRET', TELEGRAM_CHAT_ID: '42' } as unknown as NodeJS.ProcessEnv;

  it('does nothing without configuration', async () => {
    const fetchImpl = vi.fn();
    expect(telegramConfigured({} as NodeJS.ProcessEnv)).toBe(false);
    expect(await sendTelegram('hi', {} as NodeJS.ProcessEnv, fetchImpl)).toMatchObject({ ok: false });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('posts to the bot API with the chat id', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true });
    expect(await sendTelegram('hi', env, fetchImpl)).toEqual({ ok: true });
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe('https://api.telegram.org/botSECRET/sendMessage');
    expect(JSON.parse(init.body)).toMatchObject({ chat_id: '42', text: 'hi', parse_mode: 'HTML' });
  });

  it('never leaks the token in an error', async () => {
    const bad = vi.fn().mockResolvedValue({ ok: false, status: 401, json: async () => ({ description: 'Unauthorized' }) });
    expect(await sendTelegram('hi', env, bad)).toEqual({ ok: false, error: 'Telegram 401: Unauthorized' });
    const boom = vi.fn().mockRejectedValue(new Error('fetch failed for https://api.telegram.org/botSECRET/sendMessage'));
    const res = await sendTelegram('hi', env, boom);
    expect(JSON.stringify(res)).not.toContain('SECRET');
  });
});
