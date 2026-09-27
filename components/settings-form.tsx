'use client';

import { startTransition, useActionState } from 'react';
import { Button } from '@/components/ui/button';
import type { FormState } from '@/app/(app)/settings/state';

type Action = (prev: FormState, formData: FormData) => Promise<FormState>;

/**
 * A settings section's form. One server action handles it; the button pressed arrives as `intent`
 * ("save", or "secondary" for e.g. "Preview impact"). The returned FormState is announced under
 * the buttons, so there is no page reload.
 */
export function SettingsForm({
  action,
  secondaryLabel,
  submitLabel = 'Save',
  children,
}: {
  action: Action;
  secondaryLabel?: string;
  submitLabel?: string;
  children: React.ReactNode;
}) {
  const [state, run, pending] = useActionState<FormState, FormData>(action, { status: 'idle' });
  // Not `<form action>`: React 19 resets uncontrolled fields after such an action, which would throw away
  // the edits you are previewing. Submitting by hand keeps them; the button pressed still arrives as `intent`.
  const onSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const data = new FormData(e.currentTarget, (e.nativeEvent as SubmitEvent).submitter);
    startTransition(() => run(data));
  };

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      {children}
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" name="intent" value="save" size="sm" disabled={pending}>
          {pending ? 'Working…' : submitLabel}
        </Button>
        {secondaryLabel ? (
          <Button type="submit" name="intent" value="secondary" size="sm" variant="outline" disabled={pending}>
            {secondaryLabel}
          </Button>
        ) : null}
        <p role="status" aria-live="polite" className={state.status === 'error' ? 'text-negative text-sm' : 'text-muted-foreground text-sm'}>
          {state.message}
        </p>
      </div>
      {state.preview ? (
        <dl className="bg-muted/50 grid grid-cols-2 gap-3 rounded-lg p-3 text-sm sm:grid-cols-5">
          {(
            [
              ['Saved rule', state.preview.current],
              ['This rule', state.preview.candidate],
              ['Companies gained', state.preview.companiesGained],
              ['Companies lost', state.preview.companiesLost],
              ['Stored signals', state.preview.stored],
            ] as const
          ).map(([label, n]) => (
            <div key={label}>
              <dt className="text-muted-foreground text-xs">{label}</dt>
              <dd className="font-mono text-base tabular-nums">{n}</dd>
            </div>
          ))}
        </dl>
      ) : null}
    </form>
  );
}
