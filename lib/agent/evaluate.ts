import { PROMPTS, type PromptSpec } from './prompts';
import { LlmError, type LlmProvider } from './provider';
import { parseAgentOutput, type AgentOutput } from './schema';

interface Usage {
  tokensIn: number;
  tokensOut: number;
  latencyMs: number;
}

export type EvaluationResult =
  | ({ status: 'ok'; output: AgentOutput; raw: string } & Usage)
  | ({ status: 'agent_failed'; error: string; raw: string | null } & Usage);

/**
 * Runs the agent on an assembled bundle (spec §5.2). Invalid JSON is retried once with the
 * validation error fed back; after that, or on any provider error, the result is
 * `agent_failed`. It never throws: a failed evaluation must not block the pipeline.
 */
export async function evaluateBundle(provider: LlmProvider, bundle: unknown, prompt: PromptSpec = PROMPTS.v1): Promise<EvaluationResult> {
  const usage: Usage = { tokensIn: 0, tokensOut: 0, latencyMs: 0 };
  const user = prompt.user(bundle);
  let raw: string | null = null;
  let error = '';

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await provider.generate({
        system: prompt.system,
        user:
          attempt === 0
            ? user
            : `${user}\n\nYour previous answer was rejected: ${error}. Return only the JSON object, with every field.`,
      });
      usage.tokensIn += res.tokensIn;
      usage.tokensOut += res.tokensOut;
      usage.latencyMs += res.latencyMs;
      raw = res.text;

      const parsed = parseAgentOutput(res.text);
      if (parsed.ok) return { status: 'ok', output: parsed.value, raw: res.text, ...usage };
      error = parsed.error;
    } catch (err) {
      // The provider already retried transient failures; whatever is left is final.
      return { status: 'agent_failed', error: err instanceof LlmError ? err.message : `Unexpected error: ${String(err)}`, raw, ...usage };
    }
  }
  return { status: 'agent_failed', error: `Invalid output after retry: ${error}`, raw, ...usage };
}
