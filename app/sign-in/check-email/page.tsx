import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

export default function CheckEmailPage() {
  return (
    <main className="flex min-h-screen items-center justify-center p-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>Check your email</CardTitle>
          <CardDescription>A sign-in link is on its way. It expires in 24 hours.</CardDescription>
        </CardHeader>
        <CardContent className="text-muted-foreground text-sm">
          You can close this tab once you&apos;ve clicked the link.
        </CardContent>
      </Card>
    </main>
  );
}
