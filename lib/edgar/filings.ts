import { EdgarError } from './client';
import { easternToUtc } from './time';

/** CIKs appear as "4977", "0000004977" or numbers; store them as 10 digits. */
export function normalizeCik(cik: string | number): string {
  return String(cik).trim().padStart(10, '0');
}

export interface IndexFiling {
  form: '4' | '4/A';
  accession: string;
  url: string;
}

export function dailyIndexUrl(yyyymmdd: string): string {
  const quarter = Math.ceil(Number(yyyymmdd.slice(4, 6)) / 3);
  return `https://www.sec.gov/Archives/edgar/daily-index/${yyyymmdd.slice(0, 4)}/QTR${quarter}/form.${yyyymmdd}.idx`;
}

/**
 * Form 4 and 4/A rows of a daily form index. A filing is listed once per filer
 * (the issuer and each reporting owner), so the same accession repeats: dedupe.
 */
export function parseDailyIndex(text: string): IndexFiling[] {
  const seen = new Set<string>();
  const filings: IndexFiling[] = [];
  for (const line of text.split('\n')) {
    const m = /^(4|4\/A)\s.*?(edgar\/data\/\d+\/(\d{10}-\d{2}-\d{6})\.txt)/.exec(line);
    if (m && !seen.has(m[3])) {
      seen.add(m[3]);
      filings.push({ form: m[1] as '4' | '4/A', accession: m[3], url: `https://www.sec.gov/Archives/${m[2]}` });
    }
  }
  return filings;
}

export interface Submission {
  accession: string;
  formType: string;
  /** The moment the market could first know (UTC). */
  acceptedAt: Date;
  /** YYYY-MM-DD */
  filedAt: string;
  issuer: { cik: string; name: string; industry: string | null };
  /** The ownership document, or null if the submission has none. */
  xml: string | null;
}

function field(text: string, label: string): string | null {
  return new RegExp(`^\\s*${label}:\\s*(.+?)\\s*$`, 'm').exec(text)?.[1] ?? null;
}

/** Splits a full-submission `.txt` into header facts and the XML document. */
export function parseSubmission(txt: string): Submission {
  const header = txt.slice(0, txt.indexOf('</SEC-HEADER>') + 1 || undefined);
  const accepted = /<ACCEPTANCE-DATETIME>(\d{14})/.exec(header)?.[1];
  const accession = field(header, 'ACCESSION NUMBER');
  const formType = field(header, 'CONFORMED SUBMISSION TYPE');
  const filed = field(header, 'FILED AS OF DATE');
  const issuerBlock = header.slice(Math.max(header.indexOf('\nISSUER:'), 0));
  const issuerCik = field(issuerBlock, 'CENTRAL INDEX KEY');
  const issuerName = field(issuerBlock, 'COMPANY CONFORMED NAME');

  if (!accepted || !accession || !formType || !filed || !issuerCik || !issuerName) {
    throw new EdgarError('Submission header is missing required fields');
  }

  return {
    accession,
    formType,
    acceptedAt: easternToUtc(accepted),
    filedAt: `${filed.slice(0, 4)}-${filed.slice(4, 6)}-${filed.slice(6, 8)}`,
    issuer: {
      cik: normalizeCik(issuerCik),
      name: issuerName,
      industry: /STANDARD INDUSTRIAL CLASSIFICATION:\s*(.+?)\s*\[\d+\]/.exec(issuerBlock)?.[1] ?? null,
    },
    xml: /<XML>\s*([\s\S]*?)\s*<\/XML>/.exec(txt)?.[1] ?? null,
  };
}
