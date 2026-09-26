/** Today's date in Chicago (the schedule's timezone), as YYYY-MM-DD. */
export function chicagoToday(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Chicago',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

/**
 * The `n` weekdays before `today` (YYYY-MM-DD), most recent first, as YYYYMMDD.
 * Weekends only: exchange holidays are handled by EDGAR having no index for the
 * day, and an exact market calendar arrives with milestone 5.
 */
export function priorBusinessDays(today: string, n: number): string[] {
  const days: string[] = [];
  const cursor = new Date(`${today}T00:00:00Z`);
  while (days.length < n) {
    cursor.setUTCDate(cursor.getUTCDate() - 1);
    const dow = cursor.getUTCDay();
    if (dow !== 0 && dow !== 6) days.push(cursor.toISOString().slice(0, 10).replaceAll('-', ''));
  }
  return days;
}

/** `today` (YYYY-MM-DD) minus `years` calendar years, clamped for Feb 29. */
export function yearsBefore(today: string, years: number): string {
  const d = new Date(`${today}T00:00:00Z`);
  const month = d.getUTCMonth();
  d.setUTCFullYear(d.getUTCFullYear() - years);
  if (d.getUTCMonth() !== month) d.setUTCDate(0); // Feb 29 -> Feb 28
  return d.toISOString().slice(0, 10);
}

/**
 * Every weekday from `from` to `to` inclusive (YYYY-MM-DD), newest first, as
 * YYYYMMDD. Newest first so a partly finished backfill still has the recent
 * history that matters most.
 */
export function weekdaysBetween(from: string, to: string): string[] {
  const days: string[] = [];
  const cursor = new Date(`${to}T00:00:00Z`);
  const start = new Date(`${from}T00:00:00Z`);
  for (; cursor >= start; cursor.setUTCDate(cursor.getUTCDate() - 1)) {
    const dow = cursor.getUTCDay();
    if (dow !== 0 && dow !== 6) days.push(cursor.toISOString().slice(0, 10).replaceAll('-', ''));
  }
  return days;
}
