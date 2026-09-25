import NextAuth from 'next-auth';
import Resend from 'next-auth/providers/resend';
import { DrizzleAdapter } from '@auth/drizzle-adapter';
import { db } from '@/lib/db';
import { accounts, sessions, users, verificationTokens } from '@/db/schema';
import { isAllowedEmail } from '@/lib/auth/allowlist';

// Single-user app: magic link via Resend, DB sessions, one allowlisted email.
export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter: DrizzleAdapter(db, {
    usersTable: users,
    accountsTable: accounts,
    sessionsTable: sessions,
    verificationTokensTable: verificationTokens,
  }),
  session: { strategy: 'database' },
  providers: [
    Resend({
      apiKey: process.env.RESEND_API_KEY,
      from: process.env.EMAIL_FROM,
    }),
  ],
  pages: {
    signIn: '/sign-in',
    verifyRequest: '/sign-in/check-email',
    error: '/sign-in',
  },
  callbacks: {
    // Runs when the link is requested (so no mail goes to strangers) and again
    // when it is clicked.
    signIn({ user }) {
      return isAllowedEmail(user.email);
    },
  },
});
