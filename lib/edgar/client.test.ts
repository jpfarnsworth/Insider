import { describe, expect, it, vi } from 'vitest';
import { createEdgarClient, EdgarError, resolveUserAgent } from './client';

const UA = 'InsiderSignals test@example.com';
const noLimit = { acquire: async () => {} };

function respond(status: number, body = '', headers: Record<string, string> = {}) {
  return new Response(body, { status, headers });
}

function makeClient(responses: Array<Response | Error>, overrides = {}) {
  const fetchImpl = vi.fn(async () => {
    const next = responses.shift();
    if (!next) throw new Error('no more responses');
    if (next instanceof Error) throw next;
    return next;
  });
  const sleeps: number[] = [];
  const client = createEdgarClient({
    userAgent: UA,
    limiter: noLimit,
    fetchImpl: fetchImpl as unknown as typeof fetch,
    sleep: async (ms) => void sleeps.push(ms),
    random: () => 1,
    ...overrides,
  });
  return { client, fetchImpl, sleeps };
}

describe('resolveUserAgent', () => {
  it('returns a trimmed value containing a contact email', () => {
    expect(resolveUserAgent('  InsiderSignals me@example.com ')).toBe('InsiderSignals me@example.com');
  });

  it('rejects a missing value or one without a contact email', () => {
    expect(() => resolveUserAgent('')).toThrow(EdgarError);
    expect(() => resolveUserAgent('InsiderSignals')).toThrow(/contact email/);
  });

  it('reads SEC_USER_AGENT by default', () => {
    vi.stubEnv('SEC_USER_AGENT', 'Env me@example.com');
    expect(resolveUserAgent()).toBe('Env me@example.com');
    vi.unstubAllEnvs();
  });
});

describe('createEdgarClient', () => {
  it('sends the User-Agent header and returns the body', async () => {
    const { client, fetchImpl } = makeClient([respond(200, 'hello')]);
    expect(await client.getText('https://www.sec.gov/x')).toBe('hello');
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://www.sec.gov/x',
      expect.objectContaining({ headers: expect.objectContaining({ 'User-Agent': UA }) }),
    );
  });

  it('parses JSON', async () => {
    const { client } = makeClient([respond(200, '{"a":1}')]);
    expect(await client.getJson<{ a: number }>('https://www.sec.gov/x')).toEqual({ a: 1 });
  });

  it('waits on the rate limiter before every attempt', async () => {
    const acquire = vi.fn(async () => {});
    const { client } = makeClient([respond(503), respond(200, 'ok')], { limiter: { acquire } });
    await client.getText('https://www.sec.gov/x');
    expect(acquire).toHaveBeenCalledTimes(2);
  });

  it('retries 429 and 503 with exponential backoff', async () => {
    const { client, sleeps } = makeClient([respond(429), respond(503), respond(200, 'ok')], {
      baseDelayMs: 100,
    });
    expect(await client.getText('https://www.sec.gov/x')).toBe('ok');
    expect(sleeps).toEqual([100, 200]);
  });

  it('applies jitter to the backoff', async () => {
    const { client, sleeps } = makeClient([respond(503), respond(200, 'ok')], {
      baseDelayMs: 100,
      random: () => 0,
    });
    await client.getText('https://www.sec.gov/x');
    expect(sleeps).toEqual([50]);
  });

  it('honours a numeric Retry-After header', async () => {
    const { client, sleeps } = makeClient([respond(429, '', { 'retry-after': '7' }), respond(200, 'ok')]);
    await client.getText('https://www.sec.gov/x');
    expect(sleeps).toEqual([7000]);
  });

  it('ignores a non-numeric Retry-After header', async () => {
    const { client, sleeps } = makeClient(
      [respond(429, '', { 'retry-after': 'Wed, 21 Oct 2026 07:28:00 GMT' }), respond(200, 'ok')],
      { baseDelayMs: 100 },
    );
    await client.getText('https://www.sec.gov/x');
    expect(sleeps).toEqual([100]);
  });

  it('retries network errors', async () => {
    const { client, sleeps } = makeClient([new Error('ECONNRESET'), respond(200, 'ok')]);
    expect(await client.getText('https://www.sec.gov/x')).toBe('ok');
    expect(sleeps).toHaveLength(1);
  });

  it('does not retry a 404', async () => {
    const { client, fetchImpl } = makeClient([respond(404)]);
    await expect(client.getText('https://www.sec.gov/x')).rejects.toMatchObject({ status: 404 });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('gives up after maxRetries and reports the last status', async () => {
    const { client, fetchImpl } = makeClient([respond(503), respond(503), respond(503)], { maxRetries: 2 });
    await expect(client.getText('https://www.sec.gov/x')).rejects.toMatchObject({ status: 503 });
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it('reports the underlying error when the network keeps failing', async () => {
    const { client } = makeClient([new Error('boom'), new Error('boom')], { maxRetries: 1 });
    await expect(client.getText('https://www.sec.gov/x')).rejects.toThrow(/boom/);
  });

  it('stringifies non-Error failures', async () => {
    const fetchImpl = vi.fn(async () => {
      throw 'plain string';
    });
    const client = createEdgarClient({
      userAgent: UA,
      limiter: noLimit,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      maxRetries: 0,
    });
    await expect(client.getText('https://www.sec.gov/x')).rejects.toThrow(/plain string/);
  });

  it('builds default limiter, fetch, sleep and jitter when not injected', async () => {
    const client = createEdgarClient({ userAgent: UA, baseDelayMs: 1 });
    expect(client.getText).toBeTypeOf('function');
  });
});
