import { z } from 'zod';

// Spec §7: a configurable round-trip cost, higher for thinly traded names.
export const COSTS_KEY = 'trading_costs';

export const costsSchema = z.object({
  /** Round-trip cost, percent of the position. */
  roundTripPct: z.number().min(0).default(0.3),
  /** Round-trip cost for names below the dollar-volume threshold. */
  illiquidRoundTripPct: z.number().min(0).default(1.0),
  /** Average daily dollar volume below which a name counts as thinly traded. */
  illiquidDollarVolume: z.number().min(0).default(1_000_000),
});

export type Costs = z.infer<typeof costsSchema>;
export const DEFAULT_COSTS: Costs = costsSchema.parse({});

/** Unknown volume is treated as thin: better to understate net returns than flatter them. */
export function roundTripCostPct(avgDollarVolume: number | null, costs: Costs = DEFAULT_COSTS): number {
  return avgDollarVolume !== null && avgDollarVolume >= costs.illiquidDollarVolume ? costs.roundTripPct : costs.illiquidRoundTripPct;
}

/** Mean of close x volume over the bars given (the caller passes the ~30 sessions before the signal). */
export function averageDollarVolume(bars: Array<{ close: number; volume: number }>): number | null {
  if (!bars.length) return null;
  return bars.reduce((sum, b) => sum + b.close * b.volume, 0) / bars.length;
}
