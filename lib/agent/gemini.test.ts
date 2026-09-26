import { describe, expect, it, vi } from 'vitest';
import { createGeminiProvider, resolveGeminiKey } from './gemini';
import { LlmError } from './provider';

const ok = (text: string, usage = { promptTokenCount: 100, candidatesTokenCount: 20, thoughtsTokenCount: 30 }) =>
  new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text }] }, finishReason: 'STOP' }], usageMetadata: usage }));

function make(responses: Array<Response | Error>, extra = {}) {
  const fetchImpl = vi.fn(async () => {
    const next = responses.shift();
    if (!next) throw new Error('no more responses');
    if (next instanceof Error) throw next;
    return next;
  });
  const sleeps: number[] = [];
  const provider = createGeminiProvider({
    apiKey: 'SECRET-KEY',
    model: 'gemini-2.5-flash',
    fetchImpl: fetchImpl as unknown as typeof fetch,
    sleep: async (ms) => void sleeps.push(ms),
    ...extra,
  });
  return { provider, fetchImpl, sleeps };
}

describe('resolveGeminiKey', () => {
  it('requires the key', () => {
    expect(() => resolveGeminiKey({})).toThrow(LlmError);
    expect(resolveGeminiKey({ GEMINI_API_KEY: ' abc ' })).toBe('abc');
  });
});

describe('gemini provider', () => {
  it('sends the key in a header, not the URL, and asks for constrained JSON', async () => {
    const { provider, fetchImpl } = make([ok('{"a":1}')]);
    await provider.generate({ system: 'sys', user: 'usr' });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent');
    expect(url).not.toContain('SECRET-KEY');
    expect((init.headers as Record<string, string>)['x-goog-api-key']).toBe('SECRET-KEY');
    const body = JSON.parse(init.body as string);
    expect(body.systemInstruction.parts[0].text).toBe('sys');
    expect(body.contents[0].parts[0].text).toBe('usr');
    expect(body.generationConfig.responseMimeType).toBe('application/json');
    expect(body.generationConfig.responseSchema.required).toContain('score');
  });

  it('returns the text with token usage, counting reasoning tokens as output', async () => {
    const times = [1000, 1450];
    const { provider } = make([ok('{"a":1}')], { now: () => times.shift() });
    expect(await provider.generate({ system: 's', user: 'u' })).toEqual({ text: '{"a":1}', tokensIn: 100, tokensOut: 50, latencyMs: 450 });
  });

  it('ignores reasoning parts and joins the answer parts', async () => {
    const res = new Response(
      JSON.stringify({ candidates: [{ content: { parts: [{ text: 'thinking...', thought: true }, { text: '{"a":' }, { text: '1}' }] } }] }),
    );
    const { provider } = make([res]);
    expect((await provider.generate({ system: 's', user: 'u' })).text).toBe('{"a":1}');
  });

  it('retries 429 and 5xx with exponential backoff', async () => {
    const { provider, sleeps } = make([new Response('', { status: 429 }), new Response('', { status: 503 }), ok('{}')]);
    await provider.generate({ system: 's', user: 'u' });
    expect(sleeps).toEqual([1000, 2000]);
  });

  it('does not retry a 400 and reports the status', async () => {
    const { provider, fetchImpl } = make([new Response('bad request', { status: 400 })]);
    await expect(provider.generate({ system: 's', user: 'u' })).rejects.toMatchObject({ name: 'LlmError', status: 400 });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('gives up after the retry limit', async () => {
    const { provider, fetchImpl } = make(Array.from({ length: 3 }, () => new Response('', { status: 503 })), { maxRetries: 2 });
    await expect(provider.generate({ system: 's', user: 'u' })).rejects.toThrow(/503/);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it('retries network errors', async () => {
    const { provider } = make([new Error('socket hang up'), ok('{}')]);
    expect((await provider.generate({ system: 's', user: 'u' })).text).toBe('{}');
  });

  it('fails clearly when the prompt is blocked or nothing comes back', async () => {
    const blocked = new Response(JSON.stringify({ promptFeedback: { blockReason: 'SAFETY' } }));
    await expect(make([blocked]).provider.generate({ system: 's', user: 'u' })).rejects.toThrow(/blocked.*SAFETY/);
    const empty = new Response(JSON.stringify({ candidates: [{ finishReason: 'MAX_TOKENS' }] }));
    await expect(make([empty]).provider.generate({ system: 's', user: 'u' })).rejects.toThrow(/MAX_TOKENS/);
  });

  it('aborts a hung request and retries it', async () => {
    let calls = 0;
    const fetchImpl = vi.fn(
      (_u: string, init?: RequestInit) =>
        ++calls === 1
          ? new Promise<Response>((_, reject) => init?.signal?.addEventListener('abort', () => reject(init.signal?.reason)))
          : Promise.resolve(ok('{}')),
    );
    const provider = createGeminiProvider({
      apiKey: 'k',
      model: 'm',
      fetchImpl: fetchImpl as unknown as typeof fetch,
      timeoutMs: 5,
      sleep: async () => {},
    });
    expect((await provider.generate({ system: 's', user: 'u' })).text).toBe('{}');
    expect(calls).toBe(2);
  });
});
