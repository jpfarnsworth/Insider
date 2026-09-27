import type { Purchase } from './detect';

// Tags describe a signal without changing whether it exists, so past numbers stay comparable.
// They are heuristics from Form 4 alone: filings don't say why someone bought.

/**
 * Every purchase on one day at one price, by 3+ people: the shape of a registered offering, IPO,
 * rights offering or mutual-holding-company conversion, where insiders take an allotment at the
 * offering price. Not discretionary open-market buying, which is where the academic edge is.
 */
export const OFFERING_LIKE = 'single_day_single_price';

export function tagsFor(members: Purchase[], insiderCount: number): string[] {
  if (members.length === 0 || insiderCount < 3) return [];
  const days = new Set(members.map((m) => m.transactionDate));
  const prices = new Set(members.map((m) => m.price));
  return days.size === 1 && prices.size === 1 ? [OFFERING_LIKE] : [];
}
