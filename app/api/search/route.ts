import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { db } from '@/lib/db';
import { isAllowedEmail } from '@/lib/auth/allowlist';
import { search } from '@/lib/search';

// Same session check as requireUser(), but a 401 instead of a redirect: this is called with fetch().
export async function GET(req: Request) {
  const session = await auth();
  if (!isAllowedEmail(session?.user?.email)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const q = new URL(req.url).searchParams.get('q') ?? '';
  return NextResponse.json({ hits: await search(db, q) }, { headers: { 'Cache-Control': 'no-store' } });
}
