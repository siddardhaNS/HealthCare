'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import type { Factor } from '@supabase/supabase-js';
import { createI18n } from '@repo/i18n';
import { Button, Card } from '@repo/ui-web';
import { createClient } from '@/lib/supabase/client';
import { Field } from '../ui/field';

const { t } = createI18n('en');

type State =
  | { step: 'loading' }
  | { step: 'enroll'; factorId: string; qr: string; secret: string }
  | { step: 'verify'; factorId: string }
  | { step: 'error' };

/** TOTP: enrol on first sign-in, verify on every later one. Success lifts the session to aal2. */
export default function MfaPage() {
  const router = useRouter();
  const [state, setState] = useState<State>({ step: 'loading' });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const supabase = createClient();
    void (async () => {
      const { data, error: err } = await supabase.auth.mfa.listFactors();
      if (err) return setState({ step: 'error' });
      const verified = data.totp.find((f: Factor) => f.status === 'verified');
      if (verified) return setState({ step: 'verify', factorId: verified.id });
      // Clear half-finished enrolments so a fresh QR code is shown.
      for (const f of data.all.filter((x: Factor) => x.factor_type === 'totp' && x.status === 'unverified')) await supabase.auth.mfa.unenroll({ factorId: f.id });
      const enrolled = await supabase.auth.mfa.enroll({ factorType: 'totp' });
      if (enrolled.error) return setState({ step: 'error' });
      setState({ step: 'enroll', factorId: enrolled.data.id, qr: enrolled.data.totp.qr_code, secret: enrolled.data.totp.secret });
    })();
  }, []);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (state.step !== 'enroll' && state.step !== 'verify') return;
    const code = String(new FormData(e.currentTarget).get('code')).replace(/\D/g, '');
    setBusy(true);
    setError(null);
    const supabase = createClient();
    const challenge = await supabase.auth.mfa.challenge({ factorId: state.factorId });
    const result = challenge.error ? challenge : await supabase.auth.mfa.verify({ factorId: state.factorId, challengeId: challenge.data.id, code });
    setBusy(false);
    if (result.error) return setError(t('console.wrongCode'));
    router.replace('/');
    router.refresh();
  }

  if (state.step === 'loading') return <main className="min-h-dvh" aria-busy="true" />;

  return (
    <main className="flex min-h-dvh items-center justify-center p-4">
      <Card className="flex w-full max-w-sm flex-col gap-6 rounded-panel">
        {state.step === 'error' ? (
          <p role="alert" className="text-danger-text">
            {t('console.genericError')}
          </p>
        ) : (
          <>
            <div className="flex flex-col gap-1">
              <h1 className="font-display text-h2 font-bold">{state.step === 'enroll' ? t('console.mfaEnrollTitle') : t('console.mfaVerifyTitle')}</h1>
              <p className="text-small text-text-muted">{state.step === 'enroll' ? t('console.mfaEnrollBody') : t('console.mfaVerifyBody')}</p>
            </div>
            {state.step === 'enroll' ? (
              <div className="flex flex-col items-center gap-3">
                {/* Supabase returns the QR code as an SVG data URL; next/image adds nothing here. */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={state.qr} alt={t('console.mfaEnrollTitle')} width={192} height={192} className="rounded-control bg-qr-background p-2" />
                <span className="text-small text-text-muted">{t('console.mfaSecret')}</span>
                <code className="font-mono text-small break-all select-all">{state.secret}</code>
              </div>
            ) : null}
            <form className="flex flex-col gap-4" onSubmit={onSubmit}>
              <Field label={t('console.mfaCode')} name="code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} required autoFocus />
              {error ? (
                <p role="alert" className="rounded-control border border-danger-border bg-danger-soft px-3 py-2 text-small text-danger-text">
                  {error}
                </p>
              ) : null}
              <Button type="submit" disabled={busy}>
                {t('console.verify')}
              </Button>
            </form>
          </>
        )}
      </Card>
    </main>
  );
}
