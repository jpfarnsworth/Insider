// SEC fair-access policy allows 10 requests/second; we stay at 8. Requests are
// spaced evenly (no bursts), and each acquire() reserves its slot synchronously,
// so concurrent callers can never exceed the rate.
export interface RateLimiter {
  acquire(): Promise<void>;
}

export function createRateLimiter({
  ratePerSec = 8,
  now = () => performance.now(),
  sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)),
}: {
  ratePerSec?: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
} = {}): RateLimiter {
  const interval = 1000 / ratePerSec;
  let nextSlot = 0;

  return {
    async acquire() {
      const t = now();
      const start = Math.max(t, nextSlot);
      nextSlot = start + interval;
      if (start > t) await sleep(start - t);
    },
  };
}
