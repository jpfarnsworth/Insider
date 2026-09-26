/** What every LLM backend must do for the evaluator, so the model is a config choice, not a code path. */
export interface LlmRequest {
  system: string;
  user: string;
}

export interface LlmResponse {
  text: string;
  tokensIn: number;
  /** Includes any hidden reasoning tokens, which are billed as output. */
  tokensOut: number;
  latencyMs: number;
}

export interface LlmProvider {
  readonly model: string;
  generate(request: LlmRequest): Promise<LlmResponse>;
}

export class LlmError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'LlmError';
  }
}
