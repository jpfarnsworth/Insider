import { describe, expect, it } from 'vitest';
import { AGENT_MODEL, DEFAULT_AGENT_LIMITS, estimateCostUsd, isPostCutoff } from './models';

describe('isPostCutoff', () => {
  it('counts only signals after the training cutoff', () => {
    expect(isPostCutoff(new Date('2025-01-30T12:00:00Z'))).toBe(false);
    expect(isPostCutoff(new Date('2025-01-31T23:00:00Z'))).toBe(false); // the cutoff day itself is not after it
    expect(isPostCutoff(new Date('2025-02-01T00:00:00Z'))).toBe(true);
    expect(isPostCutoff(new Date('2026-09-01T00:00:00Z'))).toBe(true);
  });

  it('uses the configured model cutoff by default', () => {
    expect(AGENT_MODEL.id).toBe('gemini-2.5-flash');
    expect(isPostCutoff(new Date(`${AGENT_MODEL.trainingCutoff}T00:00:00Z`))).toBe(false);
  });
});

describe('estimateCostUsd', () => {
  it('prices input and output tokens separately', () => {
    expect(estimateCostUsd(1_000_000, 0)).toBeCloseTo(0.3, 10);
    expect(estimateCostUsd(0, 1_000_000)).toBeCloseTo(2.5, 10);
    expect(estimateCostUsd(15_000, 3_000, DEFAULT_AGENT_LIMITS)).toBeCloseTo(0.012, 6);
  });
});
