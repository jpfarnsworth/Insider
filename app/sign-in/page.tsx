import { redirect } from 'next/navigation';
import { auth, signIn } from '@/auth';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; from?: string }>;
}) {
  const { error, from } = await searchParams;
  if (await auth()) redirect('/');

  // Only allow same-site relative paths as the post-login target.
  const redirectTo = from && from.startsWith('/') && !from.startsWith('//') ? from : '/';

  return (
    <main className="flex min-h-screen items-center justify-center p-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>Insider Signals</CardTitle>
          <CardDescription>Enter your email and we&apos;ll send a sign-in link.</CardDescription>
        </CardHeader>
        <CardContent>
          <form
            className="flex flex-col gap-3"
            action={async (formData: FormData) => {
              'use server';
              await signIn('resend', { email: String(formData.get('email') ?? ''), redirectTo });
            }}
          >
            <label htmlFor="email" className="sr-only">
              Email
            </label>
            <Input id="email" name="email" type="email" required autoComplete="email" placeholder="you@example.com" />
            {error ? (
              <p role="alert" className="text-destructive text-sm">
                {error === 'AccessDenied'
                  ? 'That email address is not allowed to sign in.'
                  : 'Something went wrong. Please try again.'}
              </p>
            ) : null}
            <Button type="submit">Email me a link</Button>
          </form>
        </CardContent>
      </Card>
    </main>
  );
}
