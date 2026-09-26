import { describe, expect, it } from 'vitest';
import { parseAgentOutput } from './schema';

const valid = {
  score: 72,
  conviction: 'medium',
  thesis: 'Three insiders bought after a drawdown.',
  bull_points: ['CEO bought'],
  red_flags: [],
  insider_quality_notes: 'Two first-time buyers.',
  data_gaps: ['No market cap'],
};

describe('parseAgentOutput', () => {
  it('accepts a valid object', () => {
    expect(parseAgentOutput(JSON.stringify(valid))).toEqual({ ok: true, value: valid });
  });

  it('accepts JSON wrapped in a code fence', () => {
    const r = parseAgentOutput('```json\n' + JSON.stringify(valid) + '\n```');
    expect(r.ok).toBe(true);
  });

  it('rejects text that is not JSON', () => {
    expect(parseAgentOutput('The score is 72')).toEqual({ ok: false, error: 'Response was not valid JSON' });
  });

  it('rejects a score outside 0-100 or that is not an integer', () => {
    for (const score of [101, -1, 72.5, '72']) {
      const r = parseAgentOutput(JSON.stringify({ ...valid, score }));
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error).toContain('score');
    }
  });

  it('rejects an unknown conviction and missing fields', () => {
    expect(parseAgentOutput(JSON.stringify({ ...valid, conviction: 'certain' })).ok).toBe(false);
    const missing: Partial<typeof valid> = { ...valid };
    delete missing.thesis;
    const r = parseAgentOutput(JSON.stringify(missing));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('thesis');
  });

  it('rejects an empty thesis and over-long lists', () => {
    expect(parseAgentOutput(JSON.stringify({ ...valid, thesis: '  ' })).ok).toBe(false);
    expect(parseAgentOutput(JSON.stringify({ ...valid, bull_points: Array(11).fill('x') })).ok).toBe(false);
  });

  it('trims strings', () => {
    const r = parseAgentOutput(JSON.stringify({ ...valid, thesis: '  padded  ' }));
    expect(r.ok && r.value.thesis).toBe('padded');
  });
});
