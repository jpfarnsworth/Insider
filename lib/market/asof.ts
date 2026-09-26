const etDay = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' });

/** The Eastern calendar day (YYYY-MM-DD) of an instant: the market's clock. */
export function etDate(at: Date): string {
  return etDay.format(at);
}

/**
 * Bars strictly before the signal's Eastern day, so nothing at or after the signal
 * can leak into scoring or the agent's context, even for a filing accepted after that
 * day's close (whose own close would be public but is left out for a clean rule).
 */
export function barsBefore<T extends { date: string }>(bars: T[], signalAt: Date): T[] {
  const day = etDate(signalAt);
  return bars.filter((b) => b.date < day);
}
