import { describe, expect, it } from 'vitest';
import { barPath, niceTicks } from './scale';

describe('niceTicks', () => {
  it('returns round values spanning the range', () => {
    expect(niceTicks(0, 100, 5)).toEqual([0, 20, 40, 60, 80, 100]);
    expect(niceTicks(-3.2, 7.9, 5)).toEqual([-2, 0, 2, 4, 6]);
  });

  it('handles a tiny or degenerate range', () => {
    expect(niceTicks(1, 1)).toEqual([1]);
    const t = niceTicks(0, 0.05, 5);
    expect(t[0]).toBe(0);
    expect(t.at(-1)).toBeCloseTo(0.05, 10);
  });

  it('avoids floating-point tails', () => {
    for (const v of niceTicks(0, 1, 10)) expect(String(v).length).toBeLessThan(6);
  });
});

describe('barPath', () => {
  it('rounds only the data end: upward bars round the top, downward bars the bottom', () => {
    const up = barPath(0, 20, 100, 40);
    expect(up.startsWith('M0,100L0,44')).toBe(true); // baseline corners stay square
    const down = barPath(0, 20, 100, 160);
    expect(down.startsWith('M0,100L0,156')).toBe(true);
  });

  it('draws nothing for a bar too small to see', () => {
    expect(barPath(0, 20, 100, 100.2)).toBe('');
  });

  it('caps the radius for short or narrow bars', () => {
    expect(barPath(0, 6, 100, 98)).toContain('Q0,98 2,98'); // radius limited to the 2px height
  });
});
