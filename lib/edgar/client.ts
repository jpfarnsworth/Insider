import { createRateLimiter, type RateLimiter } from './rate-limit';

export class EdgarError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'EdgarError';
  }
}

// SEC requires a descriptive User-Agent with a contact email on every request.
export function resolveUserAgent(value: string | undefined = process.env.SEC_USER_AGENT): string {
  const ua = value?.trim();
  if (!ua || !ua.includes('@')) {
    throw new EdgarError(
      'SEC_USER_AGENT must be set to a descriptive name and contact email, e.g. "InsiderSignals you@example.com"',
    );
  }
  return ua;
}

const RETRYABLE = new Set([429, 500, 502, 503, 504]);

export interface EdgarClientOptions {
  userAgent: string;
  limiter?: RateLimiter;
  fetchImpl?: typeof fetch;
  maxRetries?: number;
  baseDelayMs?: number;
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
}

export function createEdgarClient({
  userAgent,
  limiter = createRateLimiter(),
  fetchImpl = fetch,
  maxRetries = 5,
  baseDelayMs = 500,
  sleep = (ms) => new Promise<void>((resolve) => setTimeout(resolve, ms)),
  random = Math.random,
}: EdgarClientOptions) {
  function backoffMs(attempt: number, retryAfter: string | null): number {
    const seconds = Number(retryAfter);
    if (retryAfter && Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
    return baseDelayMs * 2 ** attempt * (0.5 + random() / 2);
  }

  async function getText(url: string): Promise<string> {
    for (let attempt = 0; ; attempt++) {
      await limiter.acquire();

      let response: Response | undefined;
      let failure = '';
      try {
        response = await fetchImpl(url, {
          headers: { 'User-Agent': userAgent, 'Accept-Encoding': 'gzip, deflate' },
        });
      } catch (err) {
        failure = err instanceof Error ? err.message : String(err);
      }

      if (response?.ok) return response.text();

      const retryable = !response || RETRYABLE.has(response.status);
      if (!retryable || attempt >= maxRetries) {
        throw new EdgarError(
          response ? `EDGAR ${response.status} for ${url}` : `EDGAR request failed for ${url}: ${failure}`,
          response?.status,
        );
      }
      await sleep(backoffMs(attempt, response?.headers.get('retry-after') ?? null));
    }
  }

  return {
    getText,
    async getJson<T = unknown>(url: string): Promise<T> {
      return JSON.parse(await getText(url)) as T;
    },
  };
}

export type EdgarClient = ReturnType<typeof createEdgarClient>;
