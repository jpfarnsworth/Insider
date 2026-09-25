const TZ = 'America/Chicago';

const dateTime = new Intl.DateTimeFormat('en-US', {
  timeZone: TZ,
  month: 'short',
  day: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
});

/** e.g. "Sep 23, 4:15 PM" in Central time. */
export function formatDateTime(date: Date | null | undefined): string {
  return date ? dateTime.format(date) : '—';
}

/** e.g. "1m 49s" */
export function formatDuration(start: Date, end: Date | null): string {
  if (!end) return '—';
  const s = Math.round((end.getTime() - start.getTime()) / 1000);
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`;
}
