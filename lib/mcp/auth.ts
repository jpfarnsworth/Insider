import { timingSafeEqual } from 'node:crypto';
import type { Db } from '@/lib/db';
import { mcpRequestLogs } from '@/db/schema';

// Bearer-token auth for /api/mcp, the same pattern as the Life OS MCP route: one static secret per
// purpose in the environment, no session. Read-only today; Phase 2's trading tools would add a
// separate MCP_READWRITE_TOKEN with its own scope rather than widening this one.
export type McpAuthOutcome = 'ok' | 'missing_token' | 'invalid_token' | 'insufficient_scope';

export interface McpAuthResult {
  ok: boolean;
  status?: 401;
  outcome: McpAuthOutcome;
  error?: string;
}

/** Compares in constant time, so response timing can't be used to guess the token byte by byte. */
export function tokensMatch(presented: string, expected: string): boolean {
  const a = Buffer.from(presented);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** A token under 32 characters is refused even if it matches: a short secret is a guessable one. */
export const MIN_TOKEN_LENGTH = 32;

export function checkMcpAuth(authHeader: string | null, env: NodeJS.ProcessEnv = process.env): McpAuthResult {
  const expected = env.MCP_READ_TOKEN;
  const presented = authHeader?.startsWith('Bearer ') ? authHeader.slice('Bearer '.length).trim() : '';
  if (!presented) return { ok: false, status: 401, outcome: 'missing_token', error: 'Missing bearer token' };
  if (!expected || expected.length < MIN_TOKEN_LENGTH || !tokensMatch(presented, expected)) {
    return { ok: false, status: 401, outcome: 'invalid_token', error: 'Invalid bearer token' };
  }
  return { ok: true, outcome: 'ok' };
}

/** Records one request (no arguments or results). Fire-and-forget: a logging failure must never break a call. */
export function logMcpRequest(db: Db, fields: { method: string; tool: string | null; authOutcome: McpAuthOutcome; statusCode: number }) {
  db.insert(mcpRequestLogs).values(fields).catch(() => {});
}
