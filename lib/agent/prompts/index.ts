import { SYSTEM_PROMPT as V1_SYSTEM, userPrompt as v1User, PROMPT_VERSION as V1 } from './v1';
import { SYSTEM_PROMPT as V2_SYSTEM, userPrompt as v2User, PROMPT_VERSION as V2 } from './v2';

export interface PromptSpec {
  version: string;
  system: string;
  user: (bundle: unknown) => string;
}

export const PROMPTS = {
  v1: { version: V1, system: V1_SYSTEM, user: v1User },
  v2: { version: V2, system: V2_SYSTEM, user: v2User },
} as const satisfies Record<string, PromptSpec>;

/**
 * Whether prompt v2 is in use for the holdout. It flips to true only when the distribution check in
 * docs/preregistration.md passes (scores judged by spread alone, never by returns); it is then frozen.
 */
export const V2_ADOPTED = false;

const chicagoDay = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit' });

/**
 * The prompt for a signal. Design-set signals (before the holdout starts) always use v1, so that set is one
 * consistent sample; every holdout-window signal uses v2 and only v2 (never a mix), once v2 is adopted.
 */
export function promptFor(signalAt: Date, holdoutFrom: string, v2Adopted: boolean = V2_ADOPTED): PromptSpec {
  return v2Adopted && chicagoDay.format(signalAt) >= holdoutFrom ? PROMPTS.v2 : PROMPTS.v1;
}
