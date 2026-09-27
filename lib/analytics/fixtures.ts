import type { OutcomeFact, SignalFact } from './facts';

let n = 0;
export const out = (o: Partial<OutcomeFact> = {}): OutcomeFact => ({
  status: 'complete',
  returnPct: 6,
  excessPct: 5,
  benchmarkReturnPct: 1,
  maxDrawdownPct: -3,
  exitDate: '2026-03-01',
  ...o,
});

export function fact(o: Partial<SignalFact> & { excess?: number; iwmExcess?: number; outcomeStatus?: OutcomeFact['status'] } = {}): SignalFact {
  n++;
  const { excess = 5, iwmExcess = 2, outcomeStatus = 'complete', ...rest } = o;
  return {
    id: `s${n}`,
    ticker: 'ABC',
    issuer: 'ABC Corp',
    signalAt: Date.UTC(2026, 0, 1) + n * 86_400_000,
    baselineScore: 60,
    agentScore: 60,
    conviction: 'medium',
    insiderCount: 3,
    totalValue: 300_000,
    marketCap: 500e6,
    industry: 'Software',
    roleMix: 'director',
    postCutoff: true,
    avgDollarVolume: 5_000_000,
    status: 'active',
    tags: [],
    holdout: false,
    holdoutWindow: false,
    outcomes: { 30: { SPY: out({ excessPct: excess, status: outcomeStatus }), IWM: out({ excessPct: iwmExcess, status: outcomeStatus }) } },
    ...rest,
  };
}

