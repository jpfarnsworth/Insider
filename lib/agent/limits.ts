import type { AgentLimits } from './models';

export interface Usage {
  /** Evaluations attempted today (Chicago), failed ones included: they cost tokens too. */
  evaluationsToday: number;
  /** Input plus output tokens this calendar month (Chicago). */
  tokensThisMonth: number;
}

export type StopReason = 'daily_cap' | 'monthly_budget';

/** Why no further evaluation may start right now, or null if one may (spec §5.2 cost control). */
export function stopReason(usage: Usage, limits: AgentLimits, opts: { ignoreDailyCap?: boolean } = {}): StopReason | null {
  if (usage.tokensThisMonth >= limits.monthlyTokenBudget) return 'monthly_budget';
  if (!opts.ignoreDailyCap && usage.evaluationsToday >= limits.dailyCap) return 'daily_cap';
  return null;
}
