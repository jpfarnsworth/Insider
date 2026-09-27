import type { Conviction, SignalFact } from '@/lib/analytics/facts';

// Signals-list filters (spec §9.3). The same query string drives the page, the CSV export and
// saved presets, so parsing and serialising live here and are shared.
//
// Not offered: market-cap bucket and sector. Neither has a data source yet (see CLAUDE.md), so a
// filter on them would match nothing.

export type SortKey = 'newest' | 'agent' | 'score' | 'value' | 'insiders';
export const SORT_LABELS: Record<SortKey, string> = { newest: 'Newest', agent: 'Agent', score: 'Baseline', value: 'Value', insiders: 'Insiders' };

export type RoleFilter = 'ceo_cfo' | 'officer' | 'director';
export const ROLE_LABELS: Record<RoleFilter, string> = { ceo_cfo: 'CEO or CFO', officer: 'Any officer', director: 'Director' };

export type ClusterStatus = 'active' | 'closed';
export type OutcomeFilter = 'complete' | 'pending';

/** A list row: the analytics fact plus the cluster's own status. */
export interface SignalRow extends SignalFact {
  clusterStatus: ClusterStatus;
}

export interface SignalFilters {
  q: string;
  /** YYYY-MM-DD, Chicago calendar, inclusive. */
  from: string | null;
  to: string | null;
  baselineMin: number | null;
  baselineMax: number | null;
  agentMin: number | null;
  agentMax: number | null;
  conviction: Conviction | null;
  role: RoleFilter | null;
  status: ClusterStatus | null;
  /** Whether the 30-day outcome is complete. */
  outcome: OutcomeFilter | null;
  sort: SortKey;
}

export const EMPTY_FILTERS: SignalFilters = {
  q: '',
  from: null,
  to: null,
  baselineMin: null,
  baselineMax: null,
  agentMin: null,
  agentMax: null,
  conviction: null,
  role: null,
  status: null,
  outcome: null,
  sort: 'newest',
};

type Params = Record<string, string | string[] | undefined>;

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
const date = (v: string | undefined) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v)) ? v : null);
const score = (v: string | undefined) => {
  if (v === undefined || v.trim() === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(100, Math.max(0, n)) : null;
};
const oneOf = <T extends string>(v: string | undefined, allowed: readonly T[]): T | null => (allowed.includes(v as T) ? (v as T) : null);

export function parseFilters(params: Params): SignalFilters {
  const get = (k: string) => first(params[k]);
  return {
    q: (get('q') ?? '').trim().slice(0, 80),
    from: date(get('from')),
    to: date(get('to')),
    baselineMin: score(get('bmin')),
    baselineMax: score(get('bmax')),
    agentMin: score(get('amin')),
    agentMax: score(get('amax')),
    conviction: oneOf(get('conviction'), ['low', 'medium', 'high'] as const),
    role: oneOf(get('role'), ['ceo_cfo', 'officer', 'director'] as const),
    status: oneOf(get('status'), ['active', 'closed'] as const),
    outcome: oneOf(get('outcome'), ['complete', 'pending'] as const),
    sort: oneOf(get('sort'), ['newest', 'agent', 'score', 'value', 'insiders'] as const) ?? 'newest',
  };
}

/** Canonical query string: only what differs from the defaults, in a fixed order. */
export function toQuery(f: SignalFilters): string {
  const p = new URLSearchParams();
  const put = (k: string, v: string | number | null) => v !== null && v !== '' && p.set(k, String(v));
  put('q', f.q);
  put('from', f.from);
  put('to', f.to);
  put('bmin', f.baselineMin);
  put('bmax', f.baselineMax);
  put('amin', f.agentMin);
  put('amax', f.agentMax);
  put('conviction', f.conviction);
  put('role', f.role);
  put('status', f.status);
  put('outcome', f.outcome);
  if (f.sort !== 'newest') p.set('sort', f.sort);
  return p.toString();
}

const chicagoDay = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit' });

const inRange = (v: number | null, min: number | null, max: number | null) => {
  if (min === null && max === null) return true;
  if (v === null) return false; // an unscored signal can't satisfy a score range
  return (min === null || v >= min) && (max === null || v <= max);
};

const hasCompleteOutcome = (r: SignalRow, horizon = 30) => Object.values(r.outcomes[horizon] ?? {}).some((o) => o?.status === 'complete');

export function matches(r: SignalRow, f: SignalFilters): boolean {
  if (f.q) {
    const needle = f.q.toLowerCase();
    if (!(r.ticker ?? '').toLowerCase().includes(needle) && !r.issuer.toLowerCase().includes(needle)) return false;
  }
  if (f.from || f.to) {
    const day = chicagoDay.format(new Date(r.signalAt));
    if (f.from && day < f.from) return false;
    if (f.to && day > f.to) return false;
  }
  if (!inRange(r.baselineScore, f.baselineMin, f.baselineMax)) return false;
  if (!inRange(r.agentScore, f.agentMin, f.agentMax)) return false;
  if (f.conviction && r.conviction !== f.conviction) return false;
  if (f.role === 'ceo_cfo' && r.roleMix !== 'ceo_cfo') return false;
  if (f.role === 'officer' && r.roleMix !== 'ceo_cfo' && r.roleMix !== 'other_officer') return false;
  if (f.role === 'director' && r.roleMix !== 'director') return false;
  if (f.status && r.clusterStatus !== f.status) return false;
  if (f.outcome === 'complete' && !hasCompleteOutcome(r)) return false;
  if (f.outcome === 'pending' && hasCompleteOutcome(r)) return false;
  return true;
}

const desc = (a: number | null, b: number | null) => (b ?? -Infinity) - (a ?? -Infinity);

const COMPARE: Record<SortKey, (a: SignalRow, b: SignalRow) => number> = {
  newest: (a, b) => b.signalAt - a.signalAt,
  agent: (a, b) => desc(a.agentScore, b.agentScore) || b.signalAt - a.signalAt,
  score: (a, b) => desc(a.baselineScore, b.baselineScore) || b.signalAt - a.signalAt,
  value: (a, b) => b.totalValue - a.totalValue || b.signalAt - a.signalAt,
  insiders: (a, b) => b.insiderCount - a.insiderCount || b.signalAt - a.signalAt,
};

export function applyFilters(rows: SignalRow[], f: SignalFilters): SignalRow[] {
  return rows.filter((r) => matches(r, f)).sort((a, b) => COMPARE[f.sort](a, b) || a.id.localeCompare(b.id));
}

/** Number of filters in force (sort excluded), for the "Filters" badge. */
export function activeCount(f: SignalFilters): number {
  return Object.entries(f).filter(([k, v]) => k !== 'sort' && v !== null && v !== '').length;
}
