import { z } from 'zod';

// Deterministic baseline score (spec §5.1). Bump BASELINE_VERSION whenever the
// formula changes (not just the weights): signals are re-scored when it moves.
// v1: insiders, size vs market cap, seniority, position increase, selling penalty.
// v2: adds price context (buying after a drop from the 52-week high).
export const BASELINE_VERSION = 2;
export const BASELINE_WEIGHTS_KEY = 'baseline_weights';

export const baselineWeightsSchema = z.object({
  insiders: z.number().min(0).default(25),
  valueVsMarketCap: z.number().min(0).default(15),
  seniority: z.number().min(0).default(20),
  holdingsIncrease: z.number().min(0).default(25),
  priceContext: z.number().min(0).default(15),
  /** Points removed when other insiders recently sold far more than the cluster bought. */
  sellPenaltyMax: z.number().min(0).default(20),
});

export type BaselineWeights = z.infer<typeof baselineWeightsSchema>;
export const DEFAULT_BASELINE_WEIGHTS: BaselineWeights = baselineWeightsSchema.parse({});

export interface BaselineInsider {
  isOfficer: boolean;
  officerTitle: string | null;
  isDirector: boolean;
  /** Shares bought in the cluster. */
  sharesBought: number;
  /** Holdings after the insider's most recent purchase; null when the filing omits it. */
  sharesOwnedAfter: number | null;
}

export interface BaselineInput {
  /** Insiders who count toward the cluster (per-insider minimum met). */
  insiders: BaselineInsider[];
  totalValue: number;
  marketCap: number | null;
  /** Dollar value other insiders sold in this issuer in the 90 days before the signal. */
  priorSaleValue: number;
  /** How far below its 52-week high the stock last closed before the signal, as a fraction (0.25 = 25%); null without price history. */
  drawdownFrom52wHigh: number | null;
}

export interface ScoreComponent {
  key: 'insiders' | 'valueVsMarketCap' | 'seniority' | 'holdingsIncrease' | 'priceContext';
  label: string;
  /** 0..1, or null when the data isn't available (its weight is redistributed). */
  raw: number | null;
  weight: number;
  points: number;
  note: string;
}

export interface BaselineResult {
  version: number;
  score: number;
  components: ScoreComponent[];
  penalty: { points: number; note: string };
}

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));

export type Role = 'ceo' | 'cfo' | 'officer' | 'director' | 'other';

/** CEO/CFO > other officers > directors (spec §5.1). */
export function roleOf(i: Pick<BaselineInsider, 'isOfficer' | 'officerTitle' | 'isDirector'>): Role {
  const title = i.officerTitle ?? '';
  if (/\b(ceo|chief executive)/i.test(title)) return 'ceo';
  if (/\b(cfo|chief financial)/i.test(title)) return 'cfo';
  if (i.isOfficer) return 'officer';
  if (i.isDirector) return 'director';
  return 'other';
}

const ROLE_SCORE: Record<Role, number> = { ceo: 1, cfo: 1, officer: 0.7, director: 0.45, other: 0.2 };

const pct = (x: number) => `${(x * 100).toFixed(x < 0.1 ? 2 : 0)}%`;

export function baselineScore(input: BaselineInput, weights: BaselineWeights = DEFAULT_BASELINE_WEIGHTS): BaselineResult {
  const n = input.insiders.length;

  // More insiders is better, with diminishing returns: 1 -> 0, 3 -> ~0.53, 8+ -> 1.
  const insiders = clamp01(Math.log(Math.max(n, 1)) / Math.log(8));

  // Purchase size as a share of market cap on a log scale: 0.01% -> 0, 1% -> 1.
  let valueVsMarketCap: number | null = null;
  let mcapNote = 'Market cap unavailable';
  if (input.marketCap && input.marketCap > 0 && input.totalValue > 0) {
    const ratio = input.totalValue / input.marketCap;
    valueVsMarketCap = clamp01((Math.log10(ratio) + 4) / 2);
    mcapNote = `Bought ${pct(ratio)} of market cap`;
  }

  // Top role counts most, the average rounds it out (a CEO plus a director beats a lone CEO).
  const roles = input.insiders.map(roleOf);
  const top = Math.max(0, ...roles.map((r) => ROLE_SCORE[r]));
  const mean = roles.length ? roles.reduce((s, r) => s + ROLE_SCORE[r], 0) / roles.length : 0;
  const seniority = 0.6 * top + 0.4 * mean;
  const roleCount = (r: Role) => roles.filter((x) => x === r).length;
  const seniorityNote =
    [
      roleCount('ceo') && `${roleCount('ceo')} CEO`,
      roleCount('cfo') && `${roleCount('cfo')} CFO`,
      roleCount('officer') && `${roleCount('officer')} other officer${roleCount('officer') > 1 ? 's' : ''}`,
      roleCount('director') && `${roleCount('director')} director${roleCount('director') > 1 ? 's' : ''}`,
      roleCount('other') && `${roleCount('other')} other`,
    ]
      .filter(Boolean)
      .join(', ') || 'No insiders';

  // Position increase: a first-time buyer, or one who added 50%+ to their stake, scores 1.
  const increases: number[] = [];
  let firstTime = 0;
  for (const i of input.insiders) {
    if (i.sharesOwnedAfter === null) continue;
    const before = i.sharesOwnedAfter - i.sharesBought;
    if (before <= 0) {
      increases.push(1);
      firstTime++;
    } else {
      increases.push(clamp01(i.sharesBought / before / 0.5));
    }
  }
  const holdingsIncrease = increases.length ? increases.reduce((s, x) => s + x, 0) / increases.length : null;
  const holdingsNote = increases.length
    ? `${firstTime} first-time buyer${firstTime === 1 ? '' : 's'} of ${increases.length} with holdings reported`
    : 'Holdings not reported';

  // Buying after a drop scores higher: no drawdown -> 0, 40% or more below the high -> 1.
  const dd = input.drawdownFrom52wHigh;
  const priceContext = dd === null ? null : clamp01(dd / 0.4);
  const priceNote = dd === null ? 'No price history' : `Closed ${pct(Math.max(dd, 0))} below its 52-week high`;

  const parts: Omit<ScoreComponent, 'points'>[] = [
    { key: 'insiders', label: 'Distinct insiders', raw: insiders, weight: weights.insiders, note: `${n} insider${n === 1 ? '' : 's'} bought` },
    { key: 'valueVsMarketCap', label: 'Size vs market cap', raw: valueVsMarketCap, weight: weights.valueVsMarketCap, note: mcapNote },
    { key: 'seniority', label: 'Seniority', raw: seniority, weight: weights.seniority, note: seniorityNote },
    { key: 'holdingsIncrease', label: 'Position increase', raw: holdingsIncrease, weight: weights.holdingsIncrease, note: holdingsNote },
    { key: 'priceContext', label: 'Price context', raw: priceContext, weight: weights.priceContext, note: priceNote },
  ];

  // Components with no data don't count as zero: their weight is spread over the rest.
  const available = parts.filter((p) => p.raw !== null).reduce((s, p) => s + p.weight, 0);
  const exact = parts.map((p) => (p.raw === null || available === 0 ? 0 : (p.raw * p.weight * 100) / available));
  const components: ScoreComponent[] = parts.map((p, i) => ({ ...p, points: round1(exact[i]) }));

  // Heavy selling by other insiders just before the buy is a red flag: full penalty at 2x the purchase.
  const saleRatio = input.totalValue > 0 ? input.priorSaleValue / input.totalValue : 0;
  const exactPenalty = weights.sellPenaltyMax * clamp01(saleRatio / 2);
  const penaltyPoints = round1(exactPenalty);
  const penalty = {
    points: penaltyPoints,
    note: input.priorSaleValue > 0 ? `Insiders sold ${pct(saleRatio)} of the purchase value in the prior 90 days` : 'No insider selling in the prior 90 days',
  };

  const score = Math.min(100, Math.max(0, round1(exact.reduce((s, x) => s + x, 0) - exactPenalty)));
  return { version: BASELINE_VERSION, score, components, penalty };
}

const round1 = (x: number) => Math.round(x * 10) / 10;
