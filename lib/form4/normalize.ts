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

/** Common (ordinary) stock only: no preferred, warrants, options, units, notes. */
export function isCommonStock(title: string): boolean {
  const t = normalizeSecurityTitle(title);
  return /\b(common|ordinary)\b/.test(t) && !EXCLUDED.test(t);
}
