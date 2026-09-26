import { z } from 'zod';

/**
 * The one model Phase 1 evaluates with. Its training cutoff is what separates signals
 * the model could have "remembered" from ones it could not: the Performance page and
 * the evaluation gates count only signals dated after it (spec §5.2, §11).
 */
export const AGENT_MODEL = {
  id: 'gemini-2.5-flash',
  /** Google's documented knowledge cutoff for Gemini 2.5 Flash. Confirm against the model card. */
  trainingCutoff: '2025-01-31',
} as const;

/** True when the signal falls after the model's cutoff, so it counts toward evaluation gates. */
export function isPostCutoff(signalAt: Date, cutoff: string = AGENT_MODEL.trainingCutoff): boolean {
  return signalAt.toISOString().slice(0, 10) > cutoff;
}

export const AGENT_LIMITS_KEY = 'agent_limits';

// Spec §5.2 cost control: a daily evaluation cap and a monthly token budget, editable in Settings.
export const agentLimitsSchema = z.object({
  dailyCap: z.number().int().min(0).default(50),
  monthlyTokenBudget: z.number().int().min(0).default(40_000_000),
  /** USD per million tokens, for the spend estimate only (thinking tokens bill as output). */
  inputUsdPerMTok: z.number().min(0).default(0.3),
  outputUsdPerMTok: z.number().min(0).default(2.5),
});

export type AgentLimits = z.infer<typeof agentLimitsSchema>;
export const DEFAULT_AGENT_LIMITS: AgentLimits = agentLimitsSchema.parse({});

export function estimateCostUsd(tokensIn: number, tokensOut: number, limits: AgentLimits = DEFAULT_AGENT_LIMITS): number {
  return (tokensIn * limits.inputUsdPerMTok + tokensOut * limits.outputUsdPerMTok) / 1_000_000;
}
