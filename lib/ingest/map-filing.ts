import type { filings, filingOwners, transactions } from '@/db/schema';
import { normalizeCik, type Submission } from '@/lib/edgar/filings';
import type { ParsedForm4 } from '@/lib/form4';

type FilingRow = typeof filings.$inferInsert;
type OwnerRow = Omit<typeof filingOwners.$inferInsert, 'filingId'>;
type TransactionRow = Omit<typeof transactions.$inferInsert, 'filingId'>;

export interface MappedFiling {
  issuer: { cik: string; name: string; industry: string | null; symbol: string | null };
  insiders: Array<{ cik: string; name: string }>;
  filing: FilingRow;
  owners: OwnerRow[];
  transactions: TransactionRow[];
  /** 4/A only: used to find the filing this amends. */
  originalSubmissionDate: string | null;
}

export type ParseOutcome = { parsed: ParsedForm4 } | { error: string };

const str = (n: number | null) => (n === null ? null : String(n));

/**
 * Turns a fetched submission and its parse outcome into database rows. A filing
 * that failed to parse is still stored (with its raw XML and the error), using
 * the issuer from the SGML header, so it shows up in the failure queue.
 */
export function mapFiling(url: string, sub: Submission, outcome: ParseOutcome): MappedFiling {
  const parsed = 'parsed' in outcome ? outcome.parsed : null;
  const issuer = parsed
    ? { cik: normalizeCik(parsed.issuer.cik), name: parsed.issuer.name, industry: sub.issuer.industry, symbol: parsed.issuer.tradingSymbol }
    : { ...sub.issuer, symbol: null };

  const owners = (parsed?.owners ?? []).map((o) => ({ ...o, cik: normalizeCik(o.cik) }));
  // A joint filing reports each transaction once for the whole group, so it is
  // attributed to the first (primary) owner; the rest are kept in filing_owners.
  // The parser guarantees at least one owner, and transactions exist only when parsed.
  const primary = owners[0]?.cik as string;

  return {
    issuer,
    insiders: owners.map((o) => ({ cik: o.cik, name: o.name })),
    filing: {
      accessionNo: sub.accession,
      formType: sub.formType,
      issuerCik: issuer.cik,
      acceptedAt: sub.acceptedAt,
      filedAt: sub.filedAt,
      url,
      isAmendment: sub.formType === '4/A',
      rawXml: sub.xml,
      parseStatus: parsed ? 'parsed' : 'failed',
      parseError: 'error' in outcome ? outcome.error : null,
    },
    owners: owners.map((o) => ({
      insiderCik: o.cik,
      isDirector: o.isDirector,
      isOfficer: o.isOfficer,
      officerTitle: o.officerTitle,
      isTenPctOwner: o.isTenPctOwner,
      isOther: o.isOther,
    })),
    transactions: (parsed?.transactions ?? []).map((t) => ({
      insiderCik: primary,
      issuerCik: issuer.cik,
      securityTitle: t.securityTitle,
      isDerivative: t.isDerivative,
      transactionDate: t.transactionDate,
      code: t.code,
      shares: str(t.shares),
      price: str(t.price),
      acquiredDisposed: t.acquiredDisposed,
      sharesOwnedAfter: str(t.sharesOwnedAfter),
      ownership: t.ownership,
      is10b5_1: t.is10b5_1,
      footnotes: t.footnotes,
      isQualifying: t.isQualifying,
    })),
    originalSubmissionDate: parsed?.dateOfOriginalSubmission ?? null,
  };
}
