import type { Metadata } from 'next';
import Link from 'next/link';
import { headers } from 'next/headers';
import { brand } from '@repo/brand';
import { createApiClient } from '@repo/api-client';
import { createI18n } from '@repo/i18n';
import { Card, buttonVariants } from '@repo/ui-web';
import { HandoverRecordView } from '@/app/ui/handover-record';

// The token is the credential: never leak it to other sites through the referrer.
export const metadata: Metadata = { referrer: 'no-referrer', robots: { index: false, follow: false } };

const clock = new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Kolkata' });

// The signed, expiring handover link the ER opens (plan §10). No sign-in: the
// API checks the token, logs every view and stops answering when it expires
// or the SOS is cancelled. Confirming receipt needs the partner portal.
export default async function HandoverLink({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const { t } = createI18n('en');
  const api = createApiClient({ baseUrl: process.env.API_URL ?? process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001' });
  // The API rate-limits per client; pass on who is asking, not this server.
  const forwarded = (await headers()).get('x-forwarded-for');
  const { data } = await api.GET('/v1/handover-links/{token}', {
    params: { path: { token } },
    headers: forwarded ? { 'x-forwarded-for': forwarded } : {},
    cache: 'no-store',
  });

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-4 p-4 sm:p-8">
      <span className="font-display text-title font-bold">{brand.shortName}</span>
      {!data ? (
        <Card role="alert" className="flex flex-col gap-2 rounded-panel p-5">
          <h1 className="font-display text-h2 font-bold">{t('console.link.invalid')}</h1>
          <p className="text-text-muted">{t('console.link.invalidHint')}</p>
        </Card>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="font-display text-h1 font-bold">{t('console.link.title')}</h1>
            <span className="font-mono text-title font-bold">{data.ref}</span>
            {data.isDrill ? <span className="rounded-pill bg-info-soft px-2.5 py-1 text-caption font-bold text-info-text">{t('console.cc.drill')}</span> : null}
          </div>
          <p className="text-text-muted">
            {t('console.link.forHospital', { hospital: data.hospital })} · {t('console.link.expires', { time: clock.format(new Date(data.expiresAt)) })}
          </p>
          <Card className="flex flex-col gap-3 rounded-panel p-5">
            <p className="text-small text-text-muted">{t('console.partner.recordNote')}</p>
            <HandoverRecordView r={data.record} t={t} />
          </Card>
          {data.confirmedAt ? (
            <p className="font-semibold text-success-text">{t('console.link.confirmed', { time: clock.format(new Date(data.confirmedAt)) })}</p>
          ) : (
            <Card className="flex flex-wrap items-center gap-3 rounded-panel p-5">
              <p className="flex-1 text-small">{t('console.link.confirmHint')}</p>
              <Link href="/handovers" className={buttonVariants({ variant: 'accent' })}>
                {t('console.link.signIn')}
              </Link>
            </Card>
          )}
        </>
      )}
    </main>
  );
}
