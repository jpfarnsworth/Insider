import { describe, expect, it } from 'vitest';
import { MIN_TOKEN_LENGTH, checkMcpAuth, tokensMatch } from './auth';

const TOKEN = 'a'.repeat(MIN_TOKEN_LENGTH);
const env = (v?: string) => ({ MCP_READ_TOKEN: v }) as unknown as NodeJS.ProcessEnv;

describe('checkMcpAuth', () => {
  it('accepts the configured token', () => {
    expect(checkMcpAuth(`Bearer ${TOKEN}`, env(TOKEN))).toEqual({ ok: true, outcome: 'ok' });
  });

  it('rejects a missing header, wrong scheme and empty bearer', () => {
    for (const h of [null, '', `Basic ${TOKEN}`, 'Bearer ', 'Bearer   ']) {
      expect(checkMcpAuth(h, env(TOKEN))).toMatchObject({ ok: false, status: 401, outcome: 'missing_token' });
    }
  });

  it('rejects a wrong token, including one of a different length', () => {
    expect(checkMcpAuth(`Bearer ${'b'.repeat(MIN_TOKEN_LENGTH)}`, env(TOKEN))).toMatchObject({ ok: false, outcome: 'invalid_token' });
    expect(checkMcpAuth(`Bearer ${TOKEN}x`, env(TOKEN))).toMatchObject({ ok: false, outcome: 'invalid_token' });
  });

  it('is closed when no token is configured or the configured one is too short', () => {
    expect(checkMcpAuth('Bearer anything', env(undefined))).toMatchObject({ ok: false, outcome: 'invalid_token' });
    expect(checkMcpAuth('Bearer short', env('short'))).toMatchObject({ ok: false, outcome: 'invalid_token' });
    expect(checkMcpAuth('Bearer x', env(''))).toMatchObject({ ok: false });
  });

  it('tokensMatch is exact', () => {
    expect(tokensMatch('abc', 'abc')).toBe(true);
    expect(tokensMatch('abc', 'abd')).toBe(false);
    expect(tokensMatch('abc', 'abcd')).toBe(false);
  });
});
