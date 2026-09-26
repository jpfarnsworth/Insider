import { createRateLimiter, type RateLimiter } from '@/lib/edgar/rate-limit';

export class AlpacaError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'AlpacaError';
  }
}

const RETRYABLE = new Set([429, 500, 502, 503, 504]);

export interface RawBar {
  /** YYYY-MM-DD, the trading day. */
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface CalendarDay {
  date: string;
  /** HH:MM Eastern */
  open: string;
  close: string;
}

export interface AlpacaClientOptions {
  keyId: string;
  secret: string;
  dataUrl?: string;
  baseUrl?: string;
  /** SIP needs the paid plan for very recent data; IEX is free but omits days with no IEX trades. */
  feed?: 'sip' | 'iex';
  limiter?: RateLimiter;
  fetchImpl?: typeof fetch;
  maxRetries?: number;
  baseDelayMs?: number;
  /** Abort a request (headers and body) that takes longer than this. */
  timeoutMs?: number;
  sleep?: (ms: number) => Promise<void>;
}

/** Alpaca allows 200 requests a minute on the free plan; stay under it. */
const DEFAULT_RATE_PER_SEC = 3;

export function resolveAlpacaCredentials(env: Record<string, string | undefined> = process.env) {
  const keyId = env.ALPACA_API_KEY_ID?.trim();
  const secret = env.ALPACA_API_SECRET_KEY?.trim();
  if (!keyId || !secret) throw new AlpacaError('ALPACA_API_KEY_ID and ALPACA_API_SECRET_KEY must be set');
  return {
    keyId,
    secret,
    dataUrl: env.ALPACA_DATA_URL?.trim() || undefined,
    baseUrl: env.ALPACA_BASE_URL?.trim() || undefined,
    feed: env.ALPACA_DATA_FEED === 'iex' ? ('iex' as const) : ('sip' as const),
  };
}

export function createAlpacaClient({
  keyId,
  secret,
  dataUrl = 'https://data.alpaca.markets',
  baseUrl = 'https://paper-api.alpaca.markets',
  feed = 'sip',
  limiter = createRateLimiter({ ratePerSec: DEFAULT_RATE_PER_SEC }),
  fetchImpl = fetch,
  maxRetries = 5,
  baseDelayMs = 500,
  timeoutMs = 30_000,
  sleep = (ms) => new Promise<void>((resolve) => setTimeout(resolve, ms)),
}: AlpacaClientOptions) {
  async function getJson<T>(url: string): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      await limiter.acquire();
      let response: Response | undefined;
      let failure = '';
      try {
        response = await fetchImpl(url, {
          headers: { 'APCA-API-KEY-ID': keyId, 'APCA-API-SECRET-KEY': secret },
          signal: AbortSignal.timeout(timeoutMs),
        });
        if (response.ok) return (await response.json()) as T;
      } catch (err) {
        response = undefined;
        failure = err instanceof Error ? err.message : String(err);
      }

      const retryable = !response || RETRYABLE.has(response.status);
      if (!retryable || attempt >= maxRetries) {
        const detail = response ? ` ${response.status}: ${(await response.text()).slice(0, 200)}` : `: ${failure}`;
        throw new AlpacaError(`Alpaca request failed${detail}`, response?.status);
      }
      await sleep(baseDelayMs * 2 ** attempt);
    }
  }

  interface BarsResponse {
    bars: Record<string, Array<{ t: string; o: number; h: number; l: number; c: number; v: number }>> | null;
    next_page_token: string | null;
  }

  async function fetchBars(symbols: string[], start: string, end: string, adjustment: 'raw' | 'all', useFeed: string) {
    const bars = new Map<string, RawBar[]>();
    let pageToken: string | null = null;
    do {
      const params = new URLSearchParams({
        symbols: symbols.join(','),
        timeframe: '1Day',
        start,
        end,
        adjustment,
        feed: useFeed,
        limit: '10000',
        ...(pageToken ? { page_token: pageToken } : {}),
      });
      const page: BarsResponse = await getJson(`${dataUrl}/v2/stocks/bars?${params}`);
      for (const [symbol, list] of Object.entries(page.bars ?? {})) {
        const out = bars.get(symbol) ?? [];
        for (const b of list) {
          // Daily bars are stamped 04:00Z (ET midnight) of the trading day.
          out.push({ date: b.t.slice(0, 10), open: b.o, high: b.h, low: b.l, close: b.c, volume: b.v });
        }
        bars.set(symbol, out);
      }
      pageToken = page.next_page_token;
    } while (pageToken);
    return bars;
  }

  return {
    /**
     * Daily bars for the symbols, `start`..`end` (YYYY-MM-DD). SIP refuses a range
     * reaching the latest day on the free plan; the end date is stepped back until it
     * is accepted, and the date actually reached is returned so callers know how
     * fresh the data is.
     */
    async getDailyBars(symbols: string[], start: string, end: string, adjustment: 'raw' | 'all' = 'all') {
      let reached = end;
      for (let back = 0; ; back++) {
        try {
          return { bars: await fetchBars(symbols, start, reached, adjustment, feed), through: reached };
        } catch (err) {
          const recent = err instanceof AlpacaError && err.status === 403 && /recent/i.test(err.message);
          if (!recent || back >= 3 || reached <= start) throw err;
          const d = new Date(`${reached}T00:00:00Z`);
          d.setUTCDate(d.getUTCDate() - 1);
          reached = d.toISOString().slice(0, 10);
        }
      }
    },

    async getCalendar(start: string, end: string): Promise<CalendarDay[]> {
      const rows = await getJson<Array<{ date: string; open: string; close: string }>>(
        `${baseUrl}/v2/calendar?${new URLSearchParams({ start, end })}`,
      );
      return rows.map((r) => ({ date: r.date, open: r.open, close: r.close }));
    },
  };
}

export type AlpacaClient = ReturnType<typeof createAlpacaClient>;
