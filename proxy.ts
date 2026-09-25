import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

// First line of defence only: redirect visitors with no Auth.js session cookie.
// It can't prove the session is valid (that needs the DB), so requireUser()
// re-checks it in every page and data-access function.
const SESSION_COOKIES = ['authjs.session-token', '__Secure-authjs.session-token'];

export function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;

  if (pathname.startsWith('/sign-in') || pathname.startsWith('/api/auth')) {
    return NextResponse.next();
  }

  if (SESSION_COOKIES.some((name) => req.cookies.has(name))) {
    return NextResponse.next();
  }

  // API callers get a 401 rather than an HTML redirect.
  if (pathname.startsWith('/api/')) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const url = new URL('/sign-in', req.url);
  url.searchParams.set('from', pathname);
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
