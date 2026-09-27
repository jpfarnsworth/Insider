import { z } from 'zod';
import type { Db } from '@/lib/db';
import { getSetting } from '@/lib/settings';

// A holdout window that stays unlooked-at until the design is frozen. Every time a rule or score is
// tweaked after seeing results, the data behind those results is a little less out-of-sample; signals
// from `from` onward are kept out of every aggregate and return number until you reveal them.
export const HOLDOUT_KEY = 'holdout';

export const MIN_OVERRIDE_REASON_LENGTH = 20;

export const fromChangeSchema = z.object({
  at: z.string(),
  by: z.string().nullable(),
  from: z.string(),
  to: z.string(),
  reason: z.string(),
});
export type FromChange = z.infer<typeof fromChangeSchema>;

export const holdoutSchema = z.object({
  /**
   * First signal day (Chicago calendar, YYYY-MM-DD) that is held out. LOCKED as soon as it is
   * registered (docs/preregistration.md fixes it 2026-09-27): moving it around after seeing design-set
   * results would decide, after the fact, which signals count as holdout, and moving it later would
   * quietly turn early holdout signals into visible design-set ones. Any change goes through
   * `canChangeFrom` (the same written-reason gate as an early reveal) and is logged in `fromChanges`,
   * permanently, alongside the date it happened.
   */
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'use YYYY-MM-DD').default('2026-10-01'),
  /** Lifts the mask on individual holdout signals (their pages, lists, CSV, MCP). Locked until every
   * pre-registered test has resolved, unless `abandonReason` is given (lib/analytics/prereg.ts,
   * canReveal). The three tests themselves show their own result before this is ever set: it gates
   * only the raw, per-signal data, never the aggregate numbers. */
  reveal: z.boolean().default(false),
  /** Set by the app (not user-editable) the moment reveal actually flips false -> true. */
  revealedAt: z.string().nullable().default(null),
  revealedBy: z.string().nullable().default(null),
  /** Required if reveal is set while a test is still pending; also set by the app. */
  abandonReason: z.string().max(2000).nullable().default(null),
  abandonedTests: z.array(z.enum(['H1', 'H2', 'H3'])).default([]),
  /** Every change to `from` after it was first registered, oldest first. Permanent; never cleared. */
  fromChanges: z.array(fromChangeSchema).default([]),
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

/**
 * Whether the holdout start date may change. It always may -- with a written reason of
 * `MIN_OVERRIDE_REASON_LENGTH`+ characters, the same bar as revealing before every test has resolved,
 * because moving the date without a reason is a quieter form of the same problem (deciding after the
 * fact which signals are "holdout"). Unlike `canReveal`, there is no free path: it is locked, period,
 * once it differs from what is already saved.
 */
export function canChangeFrom(current: string, next: string, reason: string | null): { ok: boolean; error?: string } {
  if (next === current) return { ok: true };
  if (reason && reason.trim().length >= MIN_OVERRIDE_REASON_LENGTH) return { ok: true };
  return {
    ok: false,
    error: `The holdout start date is locked (currently ${current}). Changing it to ${next} needs a written reason of at least ${MIN_OVERRIDE_REASON_LENGTH} characters, logged permanently -- moving it without one is exactly the quiet peeking a holdout is meant to prevent.`,
  };
}
