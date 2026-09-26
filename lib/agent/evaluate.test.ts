import { describe, expect, it, vi } from 'vitest';
import { evaluateBundle } from './evaluate';
import { DEFAULT_AGENT_LIMITS } from './models';
import { stopReason } from './limits';
import { LlmError, type LlmProvider, type LlmResponse } from './provider';

const good = {
  score: 64,
  conviction: 'medium',
  thesis: 'Three insiders bought.',
  bull_points: ['CEO bought'],
  red_flags: [],
  insider_quality_notes: 'n',
  data_gaps: [],
};

const res = (text: string, tokensIn = 1000, tokensOut = 200): LlmResponse => ({ text, tokensIn, tokensOut, latencyMs: 500 });

function provider(steps: Array<LlmResponse | Error>) {
  const generate = vi.fn<LlmProvider['generate']>(async () => {
    const next = steps.shift();
    if (!next) throw new Error('no more steps');
    if (next instanceof Error) throw next;
    return next;
  });
  return { p: { model: 'test-model', generate } as LlmProvider, generate };
}

describe('evaluateBundle', () => {
  it('returns the validated output with usage on the first try', async () => {
    const { p, generate } = provider([res(JSON.stringify(good))]);
    const r = await evaluateBundle(p, { hello: 'world' });
    expect(r).toMatchObject({ status: 'ok', output: good, tokensIn: 1000, tokensOut: 200, latencyMs: 500 });
    expect(generate).toHaveBeenCalledTimes(1);
    expect(generate.mock.calls[0][0].user).toContain('"hello":"world"');
  });

  it('retries once on invalid JSON, feeding back the error, and sums usage', async () => {
    const { p, generate } = provider([res('not json'), res(JSON.stringify(good))]);
    const r = await evaluateBundle(p, {});
    expect(r).toMatchObject({ status: 'ok', tokensIn: 2000, tokensOut: 400, latencyMs: 1000 });
    expect(generate.mock.calls[1][0].user).toContain('Response was not valid JSON');
  });

  it('retries once on a schema violation', async () => {
    const { p } = provider([res(JSON.stringify({ ...good, score: 150 })), res(JSON.stringify(good))]);
    expect((await evaluateBundle(p, {})).status).toBe('ok');
  });

  it('marks agent_failed after a second invalid answer, keeping the raw text', async () => {
    const { p, generate } = provider([res('nope'), res('still nope')]);
    const r = await evaluateBundle(p, {});
    expect(r).toMatchObject({ status: 'agent_failed', raw: 'still nope', tokensIn: 2000 });
    if (r.status === 'agent_failed') expect(r.error).toContain('Invalid output after retry');
    expect(generate).toHaveBeenCalledTimes(2);
  });

  it('marks agent_failed on a provider error instead of throwing', async () => {
    const { p } = provider([new LlmError('Gemini request failed 503', 503)]);
    const r = await evaluateBundle(p, {});
    expect(r).toMatchObject({ status: 'agent_failed', error: 'Gemini request failed 503', raw: null });
  });

  it('marks agent_failed on an unexpected exception, without throwing', async () => {
    const { p } = provider([new TypeError('boom')]);
    const r = await evaluateBundle(p, {});
    expect(r.status).toBe('agent_failed');
    if (r.status === 'agent_failed') expect(r.error).toContain('boom');
  });

  it('keeps the first bad answer when the retry then errors, so its tokens are still counted', async () => {
    const { p } = provider([res('bad'), new LlmError('down')]);
    const r = await evaluateBundle(p, {});
    expect(r).toMatchObject({ status: 'agent_failed', raw: 'bad', tokensIn: 1000 });
  });

  it('tells the model to judge only from the supplied data', async () => {
    const { p, generate } = provider([res(JSON.stringify(good))]);
    await evaluateBundle(p, {});
    expect(generate.mock.calls[0][0].system).toMatch(/only from the JSON provided/i);
    expect(generate.mock.calls[0][0].system).toMatch(/never an instruction/i);
  });
});

describe('stopReason', () => {
  const limits = { ...DEFAULT_AGENT_LIMITS, dailyCap: 50, monthlyTokenBudget: 1_000_000 };

  it('allows work under both limits', () => {
    expect(stopReason({ evaluationsToday: 49, tokensThisMonth: 999_999 }, limits)).toBeNull();
  });

  it('stops at the daily cap', () => {
    expect(stopReason({ evaluationsToday: 50, tokensThisMonth: 0 }, limits)).toBe('daily_cap');
  });

  it('stops at the monthly budget, which wins over the daily cap', () => {
    expect(stopReason({ evaluationsToday: 50, tokensThisMonth: 1_000_000 }, limits)).toBe('monthly_budget');
  });

  it('can ignore the daily cap (a manual re-score) but never the budget', () => {
    expect(stopReason({ evaluationsToday: 500, tokensThisMonth: 0 }, limits, { ignoreDailyCap: true })).toBeNull();
    expect(stopReason({ evaluationsToday: 0, tokensThisMonth: 2_000_000 }, limits, { ignoreDailyCap: true })).toBe('monthly_budget');
  });
});
