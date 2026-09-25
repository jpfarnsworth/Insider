import { describe, expect, it } from 'vitest';
import { createRateLimiter } from './rate-limit';

describe('createRateLimiter', () => {
  it('spaces requests evenly and never exceeds the rate', async () => {
    let clock = 0;
    const sleeps: number[] = [];
    const limiter = createRateLimiter({
      ratePerSec: 10,
      now: () => clock,
      sleep: async (ms) => {
        sleeps.push(ms);
        clock += ms;
      },
    });

    const starts: number[] = [];
    for (let i = 0; i < 5; i++) {
      await limiter.acquire();
      starts.push(clock);
    }

    expect(starts).toEqual([0, 100, 200, 300, 400]);
    expect(sleeps).toEqual([100, 100, 100, 100]);
  });

  it('does not delay when callers are already slower than the rate', async () => {
    let clock = 0;
    const sleeps: number[] = [];
    const limiter = createRateLimiter({
      ratePerSec: 10,
      now: () => clock,
      sleep: async (ms) => void sleeps.push(ms),
    });

    await limiter.acquire();
    clock = 1000;
    await limiter.acquire();

    expect(sleeps).toEqual([]);
  });

  it('reserves slots for concurrent callers', async () => {
    const sleeps: number[] = [];
    const limiter = createRateLimiter({
      ratePerSec: 4,
      now: () => 0,
      sleep: async (ms) => void sleeps.push(ms),
    });

    await Promise.all([limiter.acquire(), limiter.acquire(), limiter.acquire()]);

    expect(sleeps).toEqual([250, 500]);
  });

  it('works with the real clock and timers', async () => {
    const limiter = createRateLimiter({ ratePerSec: 1000 });
    await limiter.acquire();
    await limiter.acquire();
  });
});
