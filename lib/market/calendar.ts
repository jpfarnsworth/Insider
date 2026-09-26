import { easternToUtc } from '@/lib/edgar/time';

/** One regular trading session, times in Eastern (HH:MM). Early closes have an earlier `close`. */
export interface MarketDay {
  date: string;
  open: string;
  close: string;
}

/** The instant a session opens (UTC). */
export function sessionOpen(day: MarketDay): Date {
  return easternToUtc(`${day.date.replaceAll('-', '')}${day.open.replace(':', '')}00`);
}

/**
 * Entry day for a signal (spec §7): the first regular session that opens after the
 * filing was accepted. A filing accepted mid-session therefore enters at the NEXT
 * day's open, which is conservative and avoids pretending we reacted instantly.
 * `days` must be sorted ascending; null when the calendar doesn't reach that far.
 */
export function entryDay(days: MarketDay[], acceptedAt: Date): MarketDay | null {
  return days.find((d) => sessionOpen(d).getTime() > acceptedAt.getTime()) ?? null;
}

/**
 * The trading day `n` sessions into a holding period. The entry day is day 1, so a
 * 5-day horizon exits at the close of the fifth session including the entry day.
 * null when the calendar doesn't reach that far.
 */
export function horizonDay(days: MarketDay[], entryDate: string, n: number): MarketDay | null {
  const i = days.findIndex((d) => d.date === entryDate);
  return i === -1 ? null : (days[i + n - 1] ?? null);
}
