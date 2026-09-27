import { formatUsd } from '@/lib/format';

export const escapeHtml = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export function jobFailureMessage(job: string, error: string): string {
  return `⚠️ <b>Insider Signals</b>: <code>${escapeHtml(job)}</code> failed\n${escapeHtml(error.slice(0, 500))}`;
}

export interface SignalAlert {
  id: string;
  ticker: string | null;
  issuer: string;
  insiderCount: number;
  totalValue: number;
  baselineScore: number | null;
  agentScore: number | null;
  conviction: string | null;
}

export function signalAlertMessage(s: SignalAlert, baseUrl: string | undefined): string {
  const name = s.ticker ? `${s.ticker} · ${s.issuer}` : s.issuer;
  const scores = [
    s.baselineScore === null ? null : `baseline ${Math.round(s.baselineScore)}`,
    s.agentScore === null ? null : `agent ${s.agentScore}${s.conviction ? ` (${s.conviction})` : ''}`,
  ].filter(Boolean);
  const link = baseUrl ? `\n${baseUrl.replace(/\/$/, '')}/signals/${s.id}` : '';
  return `📈 <b>New signal</b>: ${escapeHtml(name)}\n${s.insiderCount} insiders bought ${formatUsd(s.totalValue)}\n${scores.join(' · ')}${link}`;
}

/** Whether either scorer is at or above the alert threshold. */
export const meetsThreshold = (s: Pick<SignalAlert, 'baselineScore' | 'agentScore'>, minScore: number): boolean =>
  (s.baselineScore !== null && s.baselineScore >= minScore) || (s.agentScore !== null && s.agentScore >= minScore);

export function staleFilingsMessage(latestDay: string | null, businessDays: number): string {
  const since = latestDay ? `since ${escapeHtml(latestDay)}` : 'ever';
  return `🔇 <b>Insider Signals</b>: no new filings ${since} (${businessDays}+ business days). The daily index job is reporting success, but check whether SEC changed the index format or the feed is empty.`;
}

export function staleSignalsMessage(latestDay: string | null, days: number): string {
  const since = latestDay ? `since ${escapeHtml(latestDay)}` : 'ever';
  return `🔇 <b>Insider Signals</b>: no new signals ${since} (${days}+ days). Ingest may be running fine while cluster detection or scoring quietly stopped producing anything.`;
}
