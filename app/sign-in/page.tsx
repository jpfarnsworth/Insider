import { redirect } from 'next/navigation';
import { AuthError } from 'next-auth';
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
          <CardDescription>Sign in to continue.</CardDescription>
        </CardHeader>
        <CardContent>
          <form
            className="flex flex-col gap-3"
            action={async (formData: FormData) => {
              'use server';
              try {
                await signIn('credentials', {
                  email: String(formData.get('email') ?? ''),
                  password: String(formData.get('password') ?? ''),
                  redirectTo,
                });
              } catch (e) {
                // signIn signals success by throwing a redirect, which must pass through.
                if (e instanceof AuthError) redirect('/sign-in?error=CredentialsSignin');
                throw e;
              }
            }}
          >
            <label htmlFor="email" className="sr-only">
              Email
            </label>
            <Input id="email" name="email" type="email" required autoComplete="username" placeholder="Email" />
            <label htmlFor="password" className="sr-only">
              Password
            </label>
            <Input
              id="password"
              name="password"
              type="password"
              required
              autoComplete="current-password"
              placeholder="Password"
            />
            {error ? (
              <p role="alert" className="text-destructive text-sm">
                Incorrect email or password, or too many attempts. Try again in a few minutes.
              </p>
            ) : null}
            <Button type="submit">Sign in</Button>
          </form>
        </CardContent>
      </Card>
    </main>
  );
}
