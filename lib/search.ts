import { and, asc, eq, ilike, or, sql } from 'drizzle-orm';
import type { Db } from '@/lib/db';
import { clusterTransactions, filings, insiders, issuers, signals, transactions } from '@/db/schema';

export type SearchKind = 'company' | 'insider' | 'filing';
export interface SearchHit {
  kind: SearchKind;
  title: string;
  subtitle: string | null;
  href: string;
}

const PER_KIND = 6;
export const MIN_QUERY = 2;

/** Escapes LIKE wildcards so user input is matched literally. */
export const likeEscape = (s: string): string => s.replace(/[\\%_]/g, (c) => `\\${c}`);

/** An accession number, whole or a prefix: 10 digits, 2 digits, 6 digits, dash-separated. */
export const looksLikeAccession = (q: string): boolean => /^\d{6,10}(-\d{0,2}(-\d{0,6})?)?$/.test(q);

/** Global search (⌘K): company name or ticker, insider name, accession number. */
export async function search(db: Db, raw: string): Promise<SearchHit[]> {
  const q = raw.trim().slice(0, 80);
  if (q.length < MIN_QUERY) return [];
  const pat = likeEscape(q);

  const [companies, people, filingRows] = await Promise.all([
    db
      .select({ cik: issuers.cik, name: issuers.name, ticker: issuers.ticker })
      .from(issuers)
      .where(or(ilike(issuers.ticker, `${pat}%`), ilike(issuers.name, `%${pat}%`)))
      // Exact ticker first, then ticker prefixes, then names.
      .orderBy(sql`(upper(${issuers.ticker}) = upper(${q})) desc`, sql`(${issuers.ticker} is not null) desc`, asc(issuers.name))
      .limit(PER_KIND),
    db.select({ cik: insiders.cik, name: insiders.name }).from(insiders).where(ilike(insiders.name, `%${pat}%`)).orderBy(asc(insiders.name)).limit(PER_KIND),
    looksLikeAccession(q)
      ? db
          .select({
            accessionNo: filings.accessionNo,
            formType: filings.formType,
            issuerCik: filings.issuerCik,
            issuer: issuers.name,
            signalId: sql<string | null>`(
              select ${signals.id} from ${clusterTransactions}
              join ${transactions} on ${transactions.id} = ${clusterTransactions.transactionId}
              join ${signals} on ${signals.clusterId} = ${clusterTransactions.clusterId}
              where ${transactions.filingId} = ${filings.id} limit 1)`,
          })
          .from(filings)
          .innerJoin(issuers, eq(issuers.cik, filings.issuerCik))
          .where(and(ilike(filings.accessionNo, `${pat}%`)))
          .orderBy(asc(filings.accessionNo))
          .limit(PER_KIND)
      : Promise.resolve([]),
  ]);

  return [
    ...companies.map((c): SearchHit => ({ kind: 'company', title: c.ticker ? `${c.ticker} · ${c.name}` : c.name, subtitle: 'Company', href: `/companies/${c.cik}` })),
    ...people.map((p): SearchHit => ({ kind: 'insider', title: p.name, subtitle: 'Insider', href: `/insiders/${p.cik}` })),
    ...filingRows.map(
      (f): SearchHit => ({
        kind: 'filing',
        title: f.accessionNo,
        subtitle: `Form ${f.formType} · ${f.issuer}${f.signalId ? ' · in a signal' : ''}`,
        href: f.signalId ? `/signals/${f.signalId}` : `/companies/${f.issuerCik}`,
      }),
    ),
  ];
}
