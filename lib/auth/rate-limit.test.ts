import { describe, expect, it } from 'vitest';
import { createLoginLimiter } from './rate-limit';

describe('createLoginLimiter', () => {
  it('blocks a key after the maximum number of failures', () => {
    const limiter = createLoginLimiter({ maxFailures: 3 });
    for (let i = 0; i < 2; i++) limiter.recordFailure('1.1.1.1');
    expect(limiter.isBlocked('1.1.1.1')).toBe(false);
    limiter.recordFailure('1.1.1.1');
    expect(limiter.isBlocked('1.1.1.1')).toBe(true);
  });

  it('tracks each key separately', () => {
    const limiter = createLoginLimiter({ maxFailures: 1 });
    limiter.recordFailure('1.1.1.1');
    expect(limiter.isBlocked('2.2.2.2')).toBe(false);
  });

  it('forgets failures once the window has passed', () => {
    let t = 0;
    const limiter = createLoginLimiter({ maxFailures: 1, windowMs: 1000, now: () => t });
    limiter.recordFailure('k');
    expect(limiter.isBlocked('k')).toBe(true);
    t = 1001;
    expect(limiter.isBlocked('k')).toBe(false);
  });

  it('clears failures on reset', () => {
    const limiter = createLoginLimiter({ maxFailures: 1 });
    limiter.recordFailure('k');
    limiter.reset('k');
    expect(limiter.isBlocked('k')).toBe(false);
  });
});
