// Security titles are free text ("Common Stock, $0.01 par value", "Class A
// Common Shares", "Series B Preferred", ...), so classification is by keyword.

export function normalizeSecurityTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9$.\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/(\s+\$?[\d.]+)?\s+par value.*$/, '');
}

const EXCLUDED = /\b(preferred|warrants?|options?|rights?|units?|notes?|debentures?|convertible)\b/;

// Filers abbreviate: real filings use "Comm Stock - $.16-2/3 value" (Analog
// Devices) and "Class A Com".
const COMMON = /\b(common|comm|com|ordinary)\b/;

/** Common (ordinary) stock only: no preferred, warrants, options, units, notes. */
export function isCommonStock(title: string): boolean {
  const t = normalizeSecurityTitle(title);
  return COMMON.test(t) && !EXCLUDED.test(t);
}
