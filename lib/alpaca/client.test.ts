import { describe, expect, it, vi } from 'vitest';
import { AlpacaError, createAlpacaClient, resolveAlpacaCredentials } from './client';

const noLimit = { acquire: async () => {} };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

function make(responses: Array<Response | Error>, extra = {}) {
  const fetchImpl = vi.fn(async () => {
    const next = responses.shift();
    if (!next) throw new Error('no more responses');
    if (next instanceof Error) throw next;
    return next;
  });
  const sleeps: number[] = [];
  const client = createAlpacaClient({
    keyId: 'KEY',
    secret: 'SECRET',
    limiter: noLimit,
    fetchImpl: fetchImpl as unknown as typeof fetch,
    sleep: async (ms) => void sleeps.push(ms),
    ...extra,
  });
  return { client, fetchImpl, sleeps };
}

const bar = (t: string, c: number) => ({ t: `${t}T04:00:00Z`, o: c - 1, h: c + 1, l: c - 2, c, v: 1000 });

describe('resolveAlpacaCredentials', () => {
  it('requires both keys', () => {
    expect(() => resolveAlpacaCredentials({})).toThrow(AlpacaError);
    expect(() => resolveAlpacaCredentials({ ALPACA_API_KEY_ID: 'a' })).toThrow(/must be set/);
  });

  it('defaults to the SIP feed and honours overrides', () => {
    expect(resolveAlpacaCredentials({ ALPACA_API_KEY_ID: 'a', ALPACA_API_SECRET_KEY: 'b' }).feed).toBe('sip');
    expect(resolveAlpacaCredentials({ ALPACA_API_KEY_ID: 'a', ALPACA_API_SECRET_KEY: 'b', ALPACA_DATA_FEED: 'iex' }).feed).toBe('iex');
  });
});

describe('getDailyBars', () => {
  it('sends credentials and maps bars to trading days', async () => {
    const { client, fetchImpl } = make([json({ bars: { SPY: [bar('2026-09-21', 770), bar('2026-09-22', 771)] }, next_page_token: null })]);
    const { bars, through } = await client.getDailyBars(['SPY'], '2026-09-21', '2026-09-22');
    expect(bars.get('SPY')).toEqual([
      { date: '2026-09-21', open: 769, high: 771, low: 768, close: 770, volume: 1000 },
      { date: '2026-09-22', open: 770, high: 772, low: 769, close: 771, volume: 1000 },
    ]);
    expect(through).toBe('2026-09-22');
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, { headers: Record<string, string> }];
    expect(init.headers).toEqual({ 'APCA-API-KEY-ID': 'KEY', 'APCA-API-SECRET-KEY': 'SECRET' });
    expect(url).toContain('feed=sip');
    expect(url).toContain('adjustment=all');
  });

  it('follows pagination', async () => {
    const { client, fetchImpl } = make([
      json({ bars: { A: [bar('2026-09-21', 10)] }, next_page_token: 'tok' }),
      json({ bars: { A: [bar('2026-09-22', 11)], B: [bar('2026-09-22', 5)] }, next_page_token: null }),
    ]);
    const { bars } = await client.getDailyBars(['A', 'B'], '2026-09-21', '2026-09-22');
    expect(bars.get('A')?.map((b) => b.date)).toEqual(['2026-09-21', '2026-09-22']);
    expect(bars.get('B')).toHaveLength(1);
    expect((fetchImpl.mock.calls[1] as unknown as [string])[0]).toContain('page_token=tok');
  });

  it('treats a null bars object as no data', async () => {
    const { client } = make([json({ bars: null, next_page_token: null })]);
    expect((await client.getDailyBars(['ZZZ'], '2026-09-21', '2026-09-22')).bars.size).toBe(0);
  });

  it('steps the end date back when SIP refuses recent data', async () => {
    const refused = () => json({ message: 'subscription does not permit querying recent SIP data' }, 403);
    const { client, fetchImpl } = make([refused(), refused(), json({ bars: { A: [bar('2026-09-22', 1)] }, next_page_token: null })]);
    const { through } = await client.getDailyBars(['A'], '2026-09-01', '2026-09-25');
    expect(through).toBe('2026-09-23');
    expect((fetchImpl.mock.calls[2] as unknown as [string])[0]).toContain('end=2026-09-23');
  });

  it('gives up on other 403s without retrying', async () => {
    const { client, fetchImpl } = make([json({ message: 'forbidden' }, 403)]);
    await expect(client.getDailyBars(['A'], '2026-09-01', '2026-09-25')).rejects.toThrow(/403/);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('retries 429 and 5xx with exponential backoff, then succeeds', async () => {
    const { client, sleeps } = make([json({}, 429), json({}, 503), json({ bars: {}, next_page_token: null })]);
    await client.getDailyBars(['A'], '2026-09-01', '2026-09-02');
    expect(sleeps).toEqual([500, 1000]);
  });

  it('retries network errors and eventually throws', async () => {
    const { client, fetchImpl } = make(Array.from({ length: 6 }, () => new Error('socket hang up')), { maxRetries: 5 });
    await expect(client.getDailyBars(['A'], '2026-09-01', '2026-09-02')).rejects.toThrow(/socket hang up/);
    expect(fetchImpl).toHaveBeenCalledTimes(6);
  });
});

describe('getCalendar', () => {
  it('returns session dates with open and close times', async () => {
    const { client, fetchImpl } = make([
      json([{ date: '2026-11-27', open: '09:30', close: '13:00', session_open: '0400', settlement_date: '2026-11-30' }]),
    ]);
    expect(await client.getCalendar('2026-11-27', '2026-11-27')).toEqual([{ date: '2026-11-27', open: '09:30', close: '13:00' }]);
    expect((fetchImpl.mock.calls[0] as unknown as [string])[0]).toContain('paper-api.alpaca.markets/v2/calendar');
  });
});

describe('request timeout', () => {
  it('aborts a hung request and retries it', async () => {
    let calls = 0;
    const fetchImpl = vi.fn(
      (_url: string, init?: RequestInit) =>
        ++calls === 1
          ? new Promise<Response>((_, reject) => init?.signal?.addEventListener('abort', () => reject(init.signal?.reason)))
          : Promise.resolve(json({ bars: {}, next_page_token: null })),
    );
    const client = createAlpacaClient({
      keyId: 'K',
      secret: 'S',
      limiter: noLimit,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      timeoutMs: 5,
      sleep: async () => {},
    });
    await client.getDailyBars(['A'], '2026-09-01', '2026-09-02');
    expect(calls).toBe(2);
  });
});
