export interface ParsedIssuer {
  cik: string;
  name: string;
  tradingSymbol: string | null;
}

export interface ParsedOwner {
  cik: string;
  name: string;
  isDirector: boolean;
  isOfficer: boolean;
  officerTitle: string | null;
  isTenPctOwner: boolean;
  isOther: boolean;
}

export interface ParsedTransaction {
  securityTitle: string;
  isDerivative: boolean;
  /** YYYY-MM-DD */
  transactionDate: string;
  code: string;
  shares: number | null;
  /** null when the filing gives no price, or only describes it in a footnote. */
  price: number | null;
  acquiredDisposed: 'A' | 'D' | null;
  sharesOwnedAfter: number | null;
  ownership: 'D' | 'I' | null;
  is10b5_1: boolean;
  /** Text of every footnote this transaction references. */
  footnotes: string[];
  /** Feeds cluster detection (spec §3.2). */
  isQualifying: boolean;
}

export interface ParsedForm4 {
  documentType: '4' | '4/A';
  /** YYYY-MM-DD */
  periodOfReport: string | null;
  /**
   * 4/A only. The XML doesn't carry the original accession number, so the
   * ingest step resolves the original filing from issuer + owner + this date.
   */
  dateOfOriginalSubmission: string | null;
  issuer: ParsedIssuer;
  /** In document order. The first owner is the primary filer. */
  owners: ParsedOwner[];
  transactions: ParsedTransaction[];
}
