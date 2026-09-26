import type { RawBar } from '@/lib/alpaca/client';

/** A daily bar with prices on the split/dividend-adjusted scale. */
export interface AdjBar {
  date: string;
  adjOpen: number;
  adjClose: number;
}

export interface StoredBar extends RawBar {
  adjClose: number;
}

/**
 * Raw OHLC plus an adjusted close is what we store (spec §3.3). The adjustment
 * factor for a day is adjClose/close, which scales that day's open too.
 */
export function toAdjBars(bars: StoredBar[]): AdjBar[] {
  return bars
    .filter((b) => b.close > 0)
    .map((b) => ({ date: b.date, adjOpen: (b.open * b.adjClose) / b.close, adjClose: b.adjClose }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

export interface HoldingResult {
  entryDate: string;
  entryPrice: number;
  exitDate: string;
  exitPrice: number;
  /** Percent, e.g. 5.25 means +5.25%. */
  returnPct: number;
  /** Percent, <= 0: worst close-to-peak fall while held, the peak starting at the entry price. */
  maxDrawdownPct: number;
}

/**
 * Buy at the entry day's (adjusted) open, sell at the exit day's (adjusted) close.
 * A day with no bar (illiquid names have days with no trades) can't be an entry;
 * the exit uses the latest bar on or before the exit day. null when either end is unpriceable.
 */
export function holdingReturn(bars: AdjBar[], entryDate: string, exitDate: string): HoldingResult | null {
  const entry = bars.find((b) => b.date === entryDate);
  if (!entry || entry.adjOpen <= 0) return null;

  const held = bars.filter((b) => b.date >= entryDate && b.date <= exitDate);
  const exit = held.at(-1);
  if (!exit) return null;

  let peak = entry.adjOpen;
  let drawdown = 0;
  for (const b of held) {
    peak = Math.max(peak, b.adjClose);
    drawdown = Math.min(drawdown, b.adjClose / peak - 1);
  }

  return {
    entryDate,
    entryPrice: entry.adjOpen,
    exitDate: exit.date,
    exitPrice: exit.adjClose,
    returnPct: (exit.adjClose / entry.adjOpen - 1) * 100,
    maxDrawdownPct: drawdown * 100,
  };
}
