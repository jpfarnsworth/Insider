import { normalizeCik } from './filings';

export const TICKERS_URL = 'https://www.sec.gov/files/company_tickers_exchange.json';

export interface TickerEntry {
  cik: string;
  name: string;
  ticker: string;
  exchange: string | null;
}

type Row = [number | string, string, string | null, string | null];

/**
 * SEC's ticker file: `{fields:[cik,name,ticker,exchange], data:[[...],...]}`.
 * A company with several share classes has several rows; the file lists the
 * primary one first, so keep the first row per CIK.
 */
export function parseTickerFile(json: { data?: Row[] }): TickerEntry[] {
  const byCik = new Map<string, TickerEntry>();
  for (const [cik, name, ticker, exchange] of json.data ?? []) {
    const key = normalizeCik(cik);
    if (ticker && !byCik.has(key)) byCik.set(key, { cik: key, name, ticker: ticker.trim(), exchange: exchange || null });
  }
  return [...byCik.values()];
}
