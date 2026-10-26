'use client';

import { Suspense, useState, type FormEvent } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { createI18n } from '@repo/i18n';
import { Button, Card } from '@repo/ui-web';
import { createClient } from '@/lib/supabase/client';
import { Field } from '../ui/field';

const { t } = createI18n('en');

export default function SignInPage() {
  return (
    <Suspense>
      <SignInForm />
    </Suspense>
  );
}

function SignInForm() {
  const router = useRouter();
  const params = useSearchParams();
  const [error, setError] = useState<string | null>(params.get('error') === 'role' ? t('console.notStaff') : null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    setBusy(true);
    setError(null);
    const supabase = createClient();
    const { error: err } = await supabase.auth.signInWithPassword({ email: String(form.get('email')), password: String(form.get('password')) });
    setBusy(false);
    if (err) return setError(err.status === 400 ? t('console.invalidCredentials') : t('console.genericError'));
    // proxy.ts sends the session on to /mfa (enrol or verify).
    router.replace('/mfa');
    router.refresh();
  }

  return (
    <main className="flex min-h-dvh items-center justify-center p-4">
      <Card className="flex w-full max-w-sm flex-col gap-6 rounded-panel">
        <div className="flex flex-col gap-1">
          <h1 className="font-display text-h2 font-bold">{t('console.signInTitle')}</h1>
          <p className="text-small text-text-muted">{t('console.signInPrompt')}</p>
        </div>
        <form className="flex flex-col gap-4" onSubmit={onSubmit} noValidate>
          <Field label={t('console.email')} name="email" type="email" autoComplete="username" required />
          <Field label={t('console.password')} name="password" type="password" autoComplete="current-password" required />
          {error ? (
            <p role="alert" className="rounded-control border border-danger-border bg-danger-soft px-3 py-2 text-small text-danger-text">
              {error}
            </p>
          ) : null}
          <Button type="submit" disabled={busy}>
            {t('web.signIn')}
          </Button>
        </form>
      </Card>
    </main>
  );
}
