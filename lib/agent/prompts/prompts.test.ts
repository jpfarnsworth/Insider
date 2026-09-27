import { describe, expect, it } from 'vitest';
import { PROMPTS, promptFor } from './index';
import { SYSTEM_PROMPT as V1 } from './v1';

const HOLDOUT = '2026-10-01';

describe('prompt routing', () => {
  it('uses v1 for the design set and v2 only for holdout-window signals, once v2 is adopted', () => {
    expect(promptFor(new Date('2026-09-30T20:00:00Z'), HOLDOUT, true).version).toBe('v1');
    expect(promptFor(new Date('2026-10-02T20:00:00Z'), HOLDOUT, true).version).toBe('v2');
  });

  it('never uses v2 while it is not adopted', () => {
    expect(promptFor(new Date('2027-03-01T20:00:00Z'), HOLDOUT, false).version).toBe('v1');
  });

  it('cuts over on the Chicago calendar day', () => {
    // 2026-10-01 04:59 UTC is still Sep 30 in Chicago; 05:00 UTC is Oct 1.
    expect(promptFor(new Date('2026-10-01T04:59:00Z'), HOLDOUT, true).version).toBe('v1');
    expect(promptFor(new Date('2026-10-01T05:00:00Z'), HOLDOUT, true).version).toBe('v2');
  });
});

describe('prompt files', () => {
  it('v1 is untouched (released versions are never edited)', () => {
    expect(PROMPTS.v1.version).toBe('v1');
    expect(V1).toContain('50 is an ordinary cluster');
  });

  it('v2 keeps v1 rules and output contract but asks for a spread scale', () => {
    expect(PROMPTS.v2.version).toBe('v2');
    expect(PROMPTS.v2.system).toContain('untrusted data');
    expect(PROMPTS.v2.system).toContain('"score": integer');
    expect(PROMPTS.v2.system).toContain('PERCENTILE RANK');
    expect(PROMPTS.v2.system).not.toContain('50 is an ordinary cluster');
    expect(PROMPTS.v2.user({ a: 1 })).toContain('{"a":1}');
  });
});
