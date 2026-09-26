import { describe, expect, it } from 'vitest';
import { averageDollarVolume, DEFAULT_COSTS, roundTripCostPct } from './costs';

describe('roundTripCostPct', () => {
  it('uses the standard cost for liquid names and the higher tier below $1M a day', () => {
    expect(roundTripCostPct(5_000_000)).toBe(0.3);
    expect(roundTripCostPct(1_000_000)).toBe(0.3);
    expect(roundTripCostPct(999_999)).toBe(1.0);
  });

  it('treats unknown volume as thin', () => {
    expect(roundTripCostPct(null)).toBe(1.0);
  });

  it('follows configured values', () => {
    expect(roundTripCostPct(10, { ...DEFAULT_COSTS, illiquidRoundTripPct: 2.5 })).toBe(2.5);
  });
});

describe('averageDollarVolume', () => {
  it('averages close x volume', () => {
    expect(averageDollarVolume([{ close: 10, volume: 100 }, { close: 20, volume: 100 }])).toBe(1500);
  });

  it('is null with no bars', () => {
    expect(averageDollarVolume([])).toBeNull();
  });
});
