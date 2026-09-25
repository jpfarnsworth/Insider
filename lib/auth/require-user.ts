import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { isAllowedEmail } from './allowlist';

// Real session check (hits the DB). The proxy only checks that a session
// cookie exists, so every page, route handler, server action and data-access
// function must call this (spec §6.0, §13).
export async function requireUser() {
  const session = await auth();
  const user = session?.user;
  if (!user || !isAllowedEmail(user.email)) redirect('/sign-in');
  return user;
}
