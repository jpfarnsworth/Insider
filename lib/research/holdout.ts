import { z } from 'zod';
import type { Db } from '@/lib/db';
import { getSetting } from '@/lib/settings';

// A holdout window that stays unlooked-at until the design is frozen. Every time a rule or score is
// tweaked after seeing results, the data behind those results is a little less out-of-sample; signals
// from `from` onward are kept out of every aggregate and return number until you reveal them.
export const HOLDOUT_KEY = 'holdout';

export const holdoutSchema = z.object({
  /** First signal day (Chicago calendar, YYYY-MM-DD) that is held out. */
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'use YYYY-MM-DD').default('2026-10-01'),
  /** Lifts the freeze. Changing it is a versioned setting change, so revealing leaves a record. */
  reveal: z.boolean().default(false),
});

export type HoldoutSettings = z.infer<typeof holdoutSchema>;

/** The date held out from, or null when the freeze is lifted. */
export const heldOutFrom = (s: HoldoutSettings): string | null => (s.reveal ? null : s.from);

const chicagoDay = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit' });

export const isHeldOut = (signalAt: number, from: string | null): boolean => from !== null && chicagoDay.format(new Date(signalAt)) >= from;

/** The configured start date, revealed or not (gate 3's official window is defined by it). */
export async function loadHoldoutStart(db: Db): Promise<string> {
  return (await getSetting(db, HOLDOUT_KEY, holdoutSchema)).from;
}

export async function loadHoldoutFrom(db: Db): Promise<string | null> {
  return heldOutFrom(await getSetting(db, HOLDOUT_KEY, holdoutSchema));
}
