const ET = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York',
  hourCycle: 'h23',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
});

/** Renders an instant as Eastern wall-clock time, YYYYMMDDHHMMSS. */
function easternStamp(date: Date): string {
  const parts = Object.fromEntries(ET.formatToParts(date).map((p) => [p.type, p.value]));
  return `${parts.year}${parts.month}${parts.day}${parts.hour}${parts.minute}${parts.second}`;
}

/**
 * EDGAR's ACCEPTANCE-DATETIME (e.g. "20260923090007") is Eastern time with no
 * zone marker. Filings arrive 6am-10pm ET, so the 14 digits are always a valid,
 * unambiguous wall-clock time: try daylight time first, then standard.
 */
export function easternToUtc(stamp: string): Date {
  const m = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})$/.exec(stamp);
  if (!m) throw new Error(`Invalid EDGAR datetime: ${stamp}`);
  const [y, mo, d, h, mi, s] = m.slice(1).map(Number);
  const asUtc = Date.UTC(y, mo - 1, d, h, mi, s);
  for (const offsetHours of [4, 5]) {
    const candidate = new Date(asUtc + offsetHours * 3_600_000);
    if (easternStamp(candidate) === stamp) return candidate;
  }
  throw new Error(`Not a real Eastern time: ${stamp}`);
}
