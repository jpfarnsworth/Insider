// RFC 4180 CSV. Cells that start with = + - @ (or a tab/CR) are prefixed with an apostrophe so a
// spreadsheet doesn't run them as formulas: names in the data come from SEC filings, which are
// untrusted. Genuine negative numbers are passed as numbers and written as-is.
const FORMULA = /^[=+\-@\t\r]/;

export type Cell = string | number | null | undefined;

export function csvCell(v: Cell): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : '';
  const safe = FORMULA.test(v) ? `'${v}` : v;
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

export function toCsv(header: string[], rows: Cell[][]): string {
  return [header, ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n';
}
