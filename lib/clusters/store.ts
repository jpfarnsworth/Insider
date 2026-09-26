import { and, eq, exists, inArray, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import type { Db } from '@/lib/db';
import { clusterEvents, clusters, clusterTransactions, filingOwners, filings, issuers, signals, transactions } from '@/db/schema';
import { getSetting } from '@/lib/settings';
import { detectClusters, type DetectedCluster, type Purchase } from './detect';
import { CLUSTER_RULE_KEY, CLUSTER_RULE_VERSION, clusterRuleSchema, type ClusterRule } from './rule';

const CHUNK = 100;

export function loadClusterRule(db: Db): Promise<ClusterRule> {
  return getSetting(db, CLUSTER_RULE_KEY, clusterRuleSchema);
}

/** Issuers with enough distinct qualifying buyers that they could possibly form a cluster. */
async function candidateIssuers(db: Db, minInsiders: number): Promise<string[]> {
  const rows = await db
    .select({ cik: transactions.issuerCik })
    .from(transactions)
    .where(eq(transactions.isQualifying, true))
    .groupBy(transactions.issuerCik)
    .having(sql`count(distinct ${transactions.insiderCik}) >= ${minInsiders}`);
  return rows.map((r) => r.cik);
}

/**
 * Qualifying purchases for the issuers. A filing that a later, parsed 4/A
 * amends is left out (the amendment's transactions replace it); filings that
 * failed to parse have no transactions.
 */
async function loadPurchases(db: Db, issuerCiks: string[]): Promise<Map<string, Purchase[]>> {
  const amendment = alias(filings, 'amendment');
  const rows = await db
    .select({
      id: transactions.id,
      issuerCik: transactions.issuerCik,
      insiderCik: transactions.insiderCik,
      filingId: transactions.filingId,
      acceptedAt: filings.acceptedAt,
      transactionDate: transactions.transactionDate,
      securityTitle: transactions.securityTitle,
      shares: transactions.shares,
      price: transactions.price,
      sharesOwnedAfter: transactions.sharesOwnedAfter,
      tenPctOnly: sql<boolean>`coalesce(${filingOwners.isTenPctOwner} and not ${filingOwners.isDirector} and not ${filingOwners.isOfficer}, false)`,
    })
    .from(transactions)
    .innerJoin(filings, eq(filings.id, transactions.filingId))
    .leftJoin(
      filingOwners,
      and(eq(filingOwners.filingId, transactions.filingId), eq(filingOwners.insiderCik, transactions.insiderCik)),
    )
    .where(
      and(
        eq(transactions.isQualifying, true),
        inArray(transactions.issuerCik, issuerCiks),
        eq(filings.parseStatus, 'parsed'),
        sql`not ${exists(
          db
            .select({ one: sql`1` })
            .from(amendment)
            .where(and(eq(amendment.amendsAccessionNo, filings.accessionNo), eq(amendment.parseStatus, 'parsed'))),
        )}`,
      ),
    );

  const byIssuer = new Map<string, Purchase[]>();
  for (const r of rows) {
    if (r.shares === null || r.price === null) continue;
    const list = byIssuer.get(r.issuerCik) ?? [];
    list.push({
      id: r.id,
      issuerCik: r.issuerCik,
      insiderCik: r.insiderCik,
      filingId: r.filingId,
      acceptedAt: r.acceptedAt.getTime(),
      transactionDate: r.transactionDate,
      securityTitle: r.securityTitle,
      shares: Number(r.shares),
      price: Number(r.price),
      sharesOwnedAfter: r.sharesOwnedAfter === null ? null : Number(r.sharesOwnedAfter),
      tenPctOnly: r.tenPctOnly,
    });
    byIssuer.set(r.issuerCik, list);
  }
  return byIssuer;
}

type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

const groupByTrigger = <T extends { triggerFilingId: string | null; windowStart: string }>(list: T[]) => {
  const groups = new Map<string, T[]>();
  for (const c of [...list].sort((a, b) => a.windowStart.localeCompare(b.windowStart))) {
    const key = c.triggerFilingId ?? '';
    groups.set(key, [...(groups.get(key) ?? []), c]);
  }
  return groups;
};

/**
 * Makes the stored clusters for an issuer match the detected ones. A detected
 * cluster is matched to a stored one by its trigger filing (pairing by window
 * order when one filing triggered several), so re-running changes nothing.
 * The signal is created once and its time never moves; stored clusters that
 * detection no longer produces are left alone rather than deleting a signal
 * that may already carry scores.
 */
async function reconcileIssuer(tx: Tx, issuerCik: string, detected: DetectedCluster[]) {
  const existing = await tx.select().from(clusters).where(eq(clusters.issuerCik, issuerCik));
  const existingByTrigger = groupByTrigger(existing);
  const seen = new Map<string, number>();
  let created = 0;
  let updated = 0;

  const detectedSorted = [...detected].sort((a, b) => a.windowStart.localeCompare(b.windowStart));
  for (const d of detectedSorted) {
    const ordinal = seen.get(d.triggerFilingId) ?? 0;
    seen.set(d.triggerFilingId, ordinal + 1);

    const fields = {
      status: d.status,
      windowStart: d.windowStart,
      windowEnd: d.windowEnd,
      insiderCount: d.insiderCount,
      totalValue: String(d.totalValue),
      firstQualifiedAt: new Date(d.signalAt),
      triggerFilingId: d.triggerFilingId,
      ruleVersion: CLUSTER_RULE_VERSION,
    };

    const match = existingByTrigger.get(d.triggerFilingId)?.[ordinal];
    let clusterId: string;
    if (match) {
      clusterId = match.id;
      await tx.update(clusters).set(fields).where(eq(clusters.id, clusterId));
      await tx.delete(clusterTransactions).where(eq(clusterTransactions.clusterId, clusterId));
      await tx.delete(clusterEvents).where(eq(clusterEvents.clusterId, clusterId));
      updated++;
    } else {
      [{ id: clusterId }] = await tx.insert(clusters).values({ issuerCik, ...fields }).returning({ id: clusters.id });
      // The signal time is fixed at creation for return tracking (spec §4.2).
      await tx.insert(signals).values({ clusterId, issuerCik, signalAt: new Date(d.signalAt) });
      created++;
    }

    await tx.insert(clusterTransactions).values(d.members.map((m) => ({ clusterId, transactionId: m.id })));
    await tx.insert(clusterEvents).values(
      d.events.map((e) => ({ clusterId, eventType: e.type, detail: e.detail, occurredAt: new Date(e.occurredAt) })),
    );
  }
  return { created, updated };
}

export interface DetectStats {
  issuersScanned: number;
  clusters: number;
  created: number;
  updated: number;
}

/** Runs detection for every issuer that could form a cluster and stores the result. Idempotent. */
export async function detectAndStoreClusters(db: Db, asOf: string, rule?: ClusterRule): Promise<DetectStats> {
  const r = rule ?? (await loadClusterRule(db));
  const ciks = await candidateIssuers(db, r.minInsiders);
  const stats: DetectStats = { issuersScanned: ciks.length, clusters: 0, created: 0, updated: 0 };

  for (let i = 0; i < ciks.length; i += CHUNK) {
    const chunk = ciks.slice(i, i + CHUNK);
    const [purchases, caps] = await Promise.all([
      loadPurchases(db, chunk),
      db.select({ cik: issuers.cik, marketCap: issuers.marketCap }).from(issuers).where(inArray(issuers.cik, chunk)),
    ]);
    const capByCik = new Map(caps.map((c) => [c.cik, c.marketCap === null ? null : Number(c.marketCap)]));

    for (const cik of chunk) {
      const detected = detectClusters(purchases.get(cik) ?? [], { rule: r, marketCap: capByCik.get(cik) ?? null, asOf });
      if (!detected.length) continue;
      const res = await db.transaction((tx) => reconcileIssuer(tx, cik, detected));
      stats.clusters += detected.length;
      stats.created += res.created;
      stats.updated += res.updated;
    }
  }
  return stats;
}

