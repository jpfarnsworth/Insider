import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm';
import type { Db } from '@/lib/db';
import { filingOwners, filings, insiders, issuers, transactions } from '@/db/schema';
import { parseForm4 } from '@/lib/form4';
import { mapFiling, type MappedFiling } from './map-filing';

type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

export type StoreResult = 'stored' | 'skipped';

async function upsertParties(tx: Tx, m: MappedFiling) {
  // The ticker map (refresh-tickers) is authoritative; the filing's own symbol
  // is only a fallback for issuers we have never seen, and never overwrites.
  await tx
    .insert(issuers)
    .values({ cik: m.issuer.cik, name: m.issuer.name, ticker: m.issuer.symbol, industry: m.issuer.industry })
    .onConflictDoUpdate({
      target: issuers.cik,
      set: { industry: sql`coalesce(excluded.industry, ${issuers.industry})` },
    });
  if (m.insiders.length) {
    // Sorted so concurrent filings sharing insiders lock rows in the same order.
    const sorted = [...m.insiders].sort((a, b) => a.cik.localeCompare(b.cik));
    await tx
      .insert(insiders)
      .values(sorted)
      .onConflictDoUpdate({ target: insiders.cik, set: { name: sql`excluded.name` } });
  }
}

async function writeChildren(tx: Tx, filingId: string, m: MappedFiling) {
  if (m.owners.length) await tx.insert(filingOwners).values(m.owners.map((o) => ({ ...o, filingId })));
  if (m.transactions.length) await tx.insert(transactions).values(m.transactions.map((t) => ({ ...t, filingId })));
}

/**
 * The filing this 4/A amends: same issuer, an original Form 4 filed on the
 * "date of original submission", by one of the same owners. The amendment's XML
 * doesn't carry the original accession number, so it has to be inferred.
 */
async function findOriginal(tx: Tx | Db, issuerCik: string, ownerCiks: string[], originalDate: string) {
  if (!ownerCiks.length) return null;
  const [row] = await tx
    .selectDistinct({ accessionNo: filings.accessionNo, acceptedAt: filings.acceptedAt })
    .from(filings)
    .innerJoin(filingOwners, eq(filingOwners.filingId, filings.id))
    .where(
      and(
        eq(filings.issuerCik, issuerCik),
        eq(filings.formType, '4'),
        eq(filings.filedAt, originalDate),
        inArray(filingOwners.insiderCik, ownerCiks),
      ),
    )
    .orderBy(asc(filings.acceptedAt))
    .limit(1);
  return row?.accessionNo ?? null;
}

const DEADLOCK = '40P01';
const MAX_DEADLOCK_RETRIES = 3;

/** Stores a fetched filing and everything parsed from it. Idempotent on accession number. Safe to call concurrently. */
export async function storeFiling(db: Db, m: MappedFiling): Promise<StoreResult> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await storeFilingOnce(db, m);
    } catch (err) {
      if ((err as { code?: string }).code !== DEADLOCK || attempt >= MAX_DEADLOCK_RETRIES) throw err;
    }
  }
}

async function storeFilingOnce(db: Db, m: MappedFiling): Promise<StoreResult> {
  return db.transaction(async (tx) => {
    await upsertParties(tx, m);

    const [row] = await tx.insert(filings).values(m.filing).onConflictDoNothing().returning({ id: filings.id });
    if (!row) return 'skipped'; // already stored, possibly by a concurrent run

    await writeChildren(tx, row.id, m);

    if (m.originalSubmissionDate) {
      const original = await findOriginal(
        tx,
        m.issuer.cik,
        m.owners.map((o) => o.insiderCik),
        m.originalSubmissionDate,
      );
      if (original) await tx.update(filings).set({ amendsAccessionNo: original }).where(eq(filings.id, row.id));
    }
    return 'stored';
  });
}

/** Accessions from `accessions` that are already stored (parsed or failed). */
export async function existingAccessions(db: Db, accessions: string[]): Promise<Set<string>> {
  const found = new Set<string>();
  for (let i = 0; i < accessions.length; i += 1000) {
    const rows = await db
      .select({ accessionNo: filings.accessionNo })
      .from(filings)
      .where(inArray(filings.accessionNo, accessions.slice(i, i + 1000)));
    rows.forEach((r) => found.add(r.accessionNo));
  }
  return found;
}

/**
 * Re-runs the parser on a stored filing's raw XML (System page "retry parse"),
 * e.g. after a parser fix. Replaces its owners and transactions.
 */
export async function reparseFiling(db: Db, filingId: string): Promise<'parsed' | 'failed' | 'missing'> {
  const [filing] = await db.select().from(filings).where(eq(filings.id, filingId)).limit(1);
  if (!filing) return 'missing';

  let outcome;
  try {
    if (!filing.rawXml) throw new Error('No XML document in this submission');
    outcome = { parsed: parseForm4(filing.rawXml) };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    await db.update(filings).set({ parseStatus: 'failed', parseError: error }).where(eq(filings.id, filingId));
    return 'failed';
  }

  const m = mapFiling(filing.url, {
    accession: filing.accessionNo,
    formType: filing.formType,
    acceptedAt: filing.acceptedAt,
    filedAt: filing.filedAt,
    issuer: { cik: filing.issuerCik, name: outcome.parsed.issuer.name, industry: null },
    xml: filing.rawXml,
  }, outcome);

  await db.transaction(async (tx) => {
    await upsertParties(tx, m);
    await tx.delete(filingOwners).where(eq(filingOwners.filingId, filingId));
    await tx.delete(transactions).where(eq(transactions.filingId, filingId));
    await writeChildren(tx, filingId, m);
    await tx.update(filings).set({ parseStatus: 'parsed', parseError: null }).where(eq(filings.id, filingId));
  });
  return 'parsed';
}

/**
 * Links amendments whose original wasn't stored yet when they arrived (e.g. a
 * backfill that loads the 4/A first). Re-reads each unlinked amendment's raw XML.
 */
export async function relinkAmendments(db: Db): Promise<number> {
  const pending = await db
    .select()
    .from(filings)
    .where(and(eq(filings.isAmendment, true), eq(filings.parseStatus, 'parsed'), isNull(filings.amendsAccessionNo)));

  let linked = 0;
  for (const f of pending) {
    const parsed = f.rawXml ? parseForm4(f.rawXml) : null;
    if (!parsed?.dateOfOriginalSubmission) continue;
    const original = await findOriginal(
      db,
      f.issuerCik,
      parsed.owners.map((o) => o.cik.padStart(10, '0')),
      parsed.dateOfOriginalSubmission,
    );
    if (original) {
      await db.update(filings).set({ amendsAccessionNo: original }).where(eq(filings.id, f.id));
      linked++;
    }
  }
  return linked;
}
