import { geminiResponseSchema } from './schema';
import { LlmError, type LlmProvider, type LlmRequest, type LlmResponse } from './provider';

const RETRYABLE = new Set([429, 500, 502, 503, 504]);

export interface GeminiOptions {
  apiKey: string;
  model: string;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  maxRetries?: number;
  baseDelayMs?: number;
  timeoutMs?: number;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

export function resolveGeminiKey(env: Record<string, string | undefined> = process.env): string {
  const key = env.GEMINI_API_KEY?.trim();
  if (!key) throw new LlmError('GEMINI_API_KEY must be set');
  return key;
}

interface GeminiResponse {
  candidates?: Array<{ content?: { parts?: Array<{ text?: string; thought?: boolean }> }; finishReason?: string }>;
  promptFeedback?: { blockReason?: string };
  usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; thoughtsTokenCount?: number };
}

export function createGeminiProvider({
  apiKey,
  model,
  baseUrl = 'https://generativelanguage.googleapis.com/v1beta',
  fetchImpl = fetch,
  maxRetries = 4,
  baseDelayMs = 1000,
  timeoutMs = 120_000,
  sleep = (ms) => new Promise<void>((resolve) => setTimeout(resolve, ms)),
  now = () => Date.now(),
}: GeminiOptions): LlmProvider {
  return {
    model,
    async generate({ system, user }: LlmRequest): Promise<LlmResponse> {
      const body = JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
        contents: [{ role: 'user', parts: [{ text: user }] }],
        generationConfig: {
          responseMimeType: 'application/json',
          responseSchema: geminiResponseSchema,
          temperature: 0.2,
          // Reasoning tokens count against this and are billed as output, so bound them.
          maxOutputTokens: 8192,
          thinkingConfig: { thinkingBudget: 2048 },
        },
      });

      const started = now();
      for (let attempt = 0; ; attempt++) {
        let response: Response | undefined;
        let failure = '';
        try {
          response = await fetchImpl(`${baseUrl}/models/${model}:generateContent`, {
            method: 'POST',
            // The key goes in a header, never the URL, so it can't end up in logs.
            headers: { 'x-goog-api-key': apiKey, 'Content-Type': 'application/json' },
            body,
            signal: AbortSignal.timeout(timeoutMs),
          });
          if (response.ok) return parse((await response.json()) as GeminiResponse, now() - started);
        } catch (err) {
          if (err instanceof LlmError) throw err;
          response = undefined;
          failure = err instanceof Error ? err.message : String(err);
        }

        const retryable = !response || RETRYABLE.has(response.status);
        if (!retryable || attempt >= maxRetries) {
          const detail = response ? ` ${response.status}: ${(await response.text()).slice(0, 300)}` : `: ${failure}`;
          throw new LlmError(`Gemini request failed${detail}`, response?.status);
        }
        await sleep(baseDelayMs * 2 ** attempt);
      }
    },
  };
}

function parse(json: GeminiResponse, latencyMs: number): LlmResponse {
  if (json.promptFeedback?.blockReason) throw new LlmError(`Gemini blocked the prompt: ${json.promptFeedback.blockReason}`);
  const candidate = json.candidates?.[0];
  // Reasoning ("thought") parts are not the answer.
  const text = (candidate?.content?.parts ?? [])
    .filter((p) => !p.thought)
    .map((p) => p.text ?? '')
    .join('');
  if (!text) throw new LlmError(`Gemini returned no text (finish reason: ${candidate?.finishReason ?? 'unknown'})`);

  const usage = json.usageMetadata ?? {};
  return {
    text,
    tokensIn: usage.promptTokenCount ?? 0,
    tokensOut: (usage.candidatesTokenCount ?? 0) + (usage.thoughtsTokenCount ?? 0),
    latencyMs,
  };
}
