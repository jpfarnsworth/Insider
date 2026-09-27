import { DEFAULT_CLUSTER_RULE, type ClusterRule } from './rule';

/** One qualifying open-market purchase (spec §3.2), as loaded from the database. */
export interface Purchase {
  id: string;
  issuerCik: string;
  insiderCik: string;
  filingId: string;
  /** Epoch ms of the filing's acceptance: when the market could first know. */
  acceptedAt: number;
  /** YYYY-MM-DD */
  transactionDate: string;
  securityTitle: string;
  shares: number;
  price: number;
  sharesOwnedAfter: number | null;
  /** The insider is a 10% owner and neither a director nor an officer. */
  tenPctOnly: boolean;
}

export type ClusterEventType = 'signal_created' | 'insider_joined' | 'purchase_added' | 'closed';

export interface ClusterEventOut {
  type: ClusterEventType;
  occurredAt: number;
  detail: Record<string, unknown>;
}

export interface DetectedCluster {
  issuerCik: string;
  members: Purchase[];
  windowStart: string;
  windowEnd: string;
  insiderCount: number;
  totalValue: number;
  /** Acceptance time of the trigger filing: the signal time. */
  signalAt: number;
  triggerFilingId: string;
  status: 'active' | 'closed';
  events: ClusterEventOut[];
}

const DAY_MS = 86_400_000;
const dayNumber = (d: string) => Math.floor(Date.parse(`${d}T00:00:00Z`) / DAY_MS);
const value = (p: Purchase) => p.shares * p.price;

/**
 * The same purchase can arrive in separate filings by related filers (a fund and
 * its adviser both reporting 1,000,000 shares at $15). Identical transactions are
 * counted once, attributed to the earliest filing. Post-transaction holdings are
 * part of the identity, so two unrelated directors who each buy 1,000 shares at
 * the same price on the same day (different holdings) stay distinct.
 */
export function dedupePurchases(purchases: Purchase[]): Purchase[] {
  const byKey = new Map<string, Purchase>();
  for (const p of [...purchases].sort(byArrival)) {
    const key = [p.issuerCik, p.transactionDate, p.securityTitle, p.shares, p.price, p.sharesOwnedAfter ?? ''].join('|');
    if (!byKey.has(key)) byKey.set(key, p);
  }
  return [...byKey.values()];
}

function byArrival(a: Purchase, b: Purchase): number {
  return a.acceptedAt - b.acceptedAt || a.transactionDate.localeCompare(b.transactionDate) || a.id.localeCompare(b.id);
}

/** Insiders who bought at least the per-insider minimum, and their combined value. */
export function summarize(members: Purchase[], rule: ClusterRule) {
  const perInsider = new Map<string, number>();
  for (const p of members) perInsider.set(p.insiderCik, (perInsider.get(p.insiderCik) ?? 0) + value(p));
  let insiderCount = 0;
  let totalValue = 0;
  for (const v of perInsider.values()) {
    if (v >= rule.minPerInsiderValue) {
      insiderCount++;
      totalValue += v;
    }
  }
  return { insiderCount, totalValue };
}

function meetsRule(members: Purchase[], rule: ClusterRule, marketCap: number | null): boolean {
  const { insiderCount, totalValue } = summarize(members, rule);
  return (
    insiderCount >= rule.minInsiders &&
    totalValue >= rule.minTotalValue &&
    (marketCap === null || marketCap >= rule.minMarketCap)
  );
}

interface Building {
  members: Purchase[];
  first: string;
  last: string;
  signalAt: number;
  triggerFilingId: string;
  insiderCount: number;
  events: ClusterEventOut[];
}

function finish(b: Building, status: 'active' | 'closed', rule: ClusterRule): DetectedCluster {
  const { insiderCount, totalValue } = summarize(b.members, rule);
  return {
    issuerCik: b.members[0].issuerCik,
    members: b.members,
    windowStart: b.first,
    windowEnd: b.last,
    insiderCount,
    totalValue,
    signalAt: b.signalAt,
    triggerFilingId: b.triggerFilingId,
    status,
    events: b.events,
  };
}

/**
 * Cluster detection for ONE issuer (spec §4). Pure and deterministic: the same
 * purchases always give the same clusters, so re-running is idempotent.
 *
 * Purchases are replayed in the order the market learned of them (filing
 * acceptance). A cluster becomes a signal at the acceptance of the filing that
 * first made some `windowDays` window of transaction dates meet the rule. Later
 * purchases within a window length of the cluster join it (recorded as events)
 * without moving the signal time. A cluster closes when no purchase has been
 * added for a full window; a later qualifying group is a new signal.
 *
 * @param asOf YYYY-MM-DD, today: decides whether the last cluster is still active.
 */
export function detectClusters(
  purchases: Purchase[],
  opts: { rule?: ClusterRule; marketCap?: number | null; asOf: string },
): DetectedCluster[] {
  const rule = opts.rule ?? DEFAULT_CLUSTER_RULE;
  const marketCap = opts.marketCap ?? null;

  const eligible = purchases.filter((p) => p.price >= rule.minPrice && !(rule.excludeTenPctOnly && p.tenPctOnly));
  const ordered = dedupePurchases(eligible).sort(byArrival);

  const done: DetectedCluster[] = [];
  // Purchases seen so far, bucketed by transaction day (with arrival order), so a window only reads its own days.
  const byDay = new Map<number, Array<{ p: Purchase; order: number }>>();
  let seen = 0;
  let active: Building | null = null;

  for (const p of ordered) {
    const pDay = dayNumber(p.transactionDate);
    const day = byDay.get(pDay) ?? [];
    day.push({ p, order: seen++ });
    byDay.set(pDay, day);

    if (active) {
      const joins = pDay <= dayNumber(active.last) + rule.windowDays && pDay >= dayNumber(active.first) - rule.windowDays;
      if (joins) {
        active.members.push(p);
        if (p.transactionDate > active.last) active.last = p.transactionDate;
        if (p.transactionDate < active.first) active.first = p.transactionDate;
        const { insiderCount, totalValue } = summarize(active.members, rule);
        active.events.push(
          insiderCount > active.insiderCount
            ? { type: 'insider_joined', occurredAt: p.acceptedAt, detail: { insiderCount, totalValue, filingId: p.filingId } }
            : { type: 'purchase_added', occurredAt: p.acceptedAt, detail: { insiderCount, totalValue, filingId: p.filingId } },
        );
        active.insiderCount = insiderCount;
        continue;
      }
      // Too far from the cluster: it closed one window after its last purchase.
      active.events.push({
        type: 'closed',
        occurredAt: Date.parse(`${active.last}T00:00:00Z`) + (rule.windowDays + 1) * DAY_MS,
        detail: { lastPurchase: active.last },
      });
      done.push(finish(active, 'closed', rule));
      active = null;
    }

    // Try every window (of windowDays consecutive dates) that contains this purchase.
    let best: Purchase[] | null = null;
    let bestKey: [number, number] = [-1, -1];
    for (let start = pDay - rule.windowDays + 1; start <= pDay; start++) {
      if (!byDay.has(start)) continue; // windows begin on a day with a purchase
      const entries: Array<{ p: Purchase; order: number }> = [];
      for (let d = start; d < start + rule.windowDays; d++) entries.push(...(byDay.get(d) ?? []));
      const inWindow = entries.sort((a, b) => a.order - b.order).map((e) => e.p);
      if (!meetsRule(inWindow, rule, marketCap)) continue;
      const s = summarize(inWindow, rule);
      if (s.insiderCount > bestKey[0] || (s.insiderCount === bestKey[0] && s.totalValue > bestKey[1])) {
        best = inWindow;
        bestKey = [s.insiderCount, s.totalValue];
      }
    }

    if (best) {
      const dates = best.map((m) => m.transactionDate).sort();
      const { insiderCount, totalValue } = summarize(best, rule);
      active = {
        members: [...best],
        first: dates[0],
        last: dates[dates.length - 1],
        signalAt: p.acceptedAt,
        triggerFilingId: p.filingId,
        insiderCount,
        events: [{ type: 'signal_created', occurredAt: p.acceptedAt, detail: { insiderCount, totalValue, filingId: p.filingId } }],
      };
    }
  }

  if (active) {
    const stillOpen = opts.asOf <= new Date(Date.parse(`${active.last}T00:00:00Z`) + rule.windowDays * DAY_MS).toISOString().slice(0, 10);
    if (!stillOpen) {
      active.events.push({
        type: 'closed',
        occurredAt: Date.parse(`${active.last}T00:00:00Z`) + (rule.windowDays + 1) * DAY_MS,
        detail: { lastPurchase: active.last },
      });
    }
    done.push(finish(active, stillOpen ? 'active' : 'closed', rule));
  }
  return done;
}
