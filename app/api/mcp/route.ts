import { NextRequest, NextResponse } from 'next/server';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { db } from '@/lib/db';
import { checkMcpAuth, logMcpRequest } from '@/lib/mcp/auth';
import { createMcpServer } from '@/lib/mcp/tools';

// MCP over HTTP, same shape as the Life OS server: stateless (a fresh server and transport per request),
// gated by a bearer token, not a session. proxy.ts lets /api/mcp through for that reason, so THIS handler
// is the access check (the one exception to "call requireUser everywhere"). Read-only tools only.
//
// CORS is open because claude.ai's connector calls this from the browser; access is decided by the
// Authorization header, not cookies, so there is no ambient credential for another site to ride.
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type, Accept, Mcp-Session-Id, Mcp-Protocol-Version, Last-Event-ID',
  'Access-Control-Expose-Headers': 'Mcp-Session-Id, Mcp-Protocol-Version',
  'Access-Control-Max-Age': '86400',
};

function withCors(res: Response): Response {
  const headers = new Headers(res.headers);
  for (const [k, v] of Object.entries(CORS_HEADERS)) headers.set(k, v);
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
}

const rpcError = (id: unknown, code: number, message: string, status: number) =>
  withCors(NextResponse.json({ jsonrpc: '2.0', id: id ?? null, error: { code, message } }, { status }));

export function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

async function handle(req: NextRequest) {
  const auth = checkMcpAuth(req.headers.get('authorization'));

  let body: unknown = undefined;
  if (auth.ok && req.method === 'POST') {
    try {
      body = await req.json();
    } catch {
      return rpcError(null, -32700, 'Parse error', 400);
    }
  }
  const rpc = body as { id?: unknown; method?: string; params?: { name?: string } } | undefined;
  const method = rpc?.method ?? req.method;
  const tool = rpc?.method === 'tools/call' ? (rpc.params?.name ?? null) : null;

  if (!auth.ok) {
    logMcpRequest(db, { method, tool, authOutcome: auth.outcome, statusCode: 401 });
    return rpcError(null, -32001, auth.error ?? 'Unauthorized', 401);
  }

  const server = createMcpServer();
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  await server.connect(transport);
  const res = await transport.handleRequest(req, body !== undefined ? { parsedBody: body } : undefined);
  logMcpRequest(db, { method, tool, authOutcome: 'ok', statusCode: res.status });
  return withCors(res);
}

export const POST = handle;
export const GET = handle;
export const DELETE = handle;
