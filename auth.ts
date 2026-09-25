import NextAuth from 'next-auth';
import Credentials from 'next-auth/providers/credentials';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@/lib/db';
import { users } from '@/db/schema';
import { isAllowedEmail } from '@/lib/auth/allowlist';
import { getDummyHash, verifyPassword } from '@/lib/auth/password';
import { createLoginLimiter } from '@/lib/auth/rate-limit';

const limiter = createLoginLimiter();

const credentialsSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

function clientKey(request: Request): string {
  const h = request.headers;
  return h.get('cf-connecting-ip') ?? h.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown';
}

// Single-user app: email + password, one allowlisted email. Auth.js can't keep
// database sessions with the Credentials provider, so sessions are signed JWT
// cookies (they can't be revoked server-side; rotating AUTH_SECRET signs
// everything out).
export const { handlers, auth, signIn, signOut } = NextAuth({
  session: { strategy: 'jwt', maxAge: 7 * 24 * 60 * 60 },
  providers: [
    Credentials({
      credentials: { email: {}, password: {} },
      async authorize(credentials, request) {
        const key = clientKey(request);
        if (limiter.isBlocked(key)) return null;

        const parsed = credentialsSchema.safeParse(credentials);
        if (!parsed.success) return null;
        const email = parsed.data.email.trim().toLowerCase();

        const [user] = isAllowedEmail(email)
          ? await db.select().from(users).where(eq(users.email, email)).limit(1)
          : [];

        // Always run a bcrypt compare so timing doesn't reveal whether the
        // account exists.
        const ok = await verifyPassword(parsed.data.password, user?.passwordHash ?? (await getDummyHash()));
        if (!ok || !user?.passwordHash) {
          limiter.recordFailure(key);
          return null;
        }

        limiter.reset(key);
        return { id: user.id, email: user.email, name: user.name };
      },
    }),
  ],
  pages: {
    signIn: '/sign-in',
    error: '/sign-in',
  },
  callbacks: {
    signIn({ user }) {
      return isAllowedEmail(user.email);
    },
  },
});
