import Link from 'next/link';
import { notFound } from 'next/navigation';
import { createI18n } from '@repo/i18n';
import { Card, cn } from '@repo/ui-web';
import { serverApi } from '@/lib/api';
import { MedicalSection } from './medical';

// Resident profile. Consent is read-only (only the resident changes it, in
// their app). Medical details follow the resident's proactive_care consent;
// the community desk never sees them. The API logs every view.
export default async function ResidentPage({ params }: { params: Promise<{ userId: string }> }) {
  const { userId } = await params;
  const { t } = createI18n('en');
  const api = await serverApi();
  const { data, response } = await api.GET('/v1/residents/{userId}', { params: { path: { userId } } });
  if (response.status === 404) notFound();
  // The API checks the role and the person's consent again, and records the disclosure.
  const medical = data?.medicalAccess === 'granted' ? (await api.GET('/v1/residents/{userId}/health', { params: { path: { userId } } })).data : undefined;

  if (!data) {
    return (
      <Card role="alert" className="text-danger-text">
        {response.status === 403 ? t('console.notStaff') : t('console.genericError')}
      </Card>
    );
  }

  const home = data.community ? [data.community, [data.tower, data.number].filter(Boolean).join('-')].join(' · ') : t('console.residents.standalone');

  return (
    <>
      <Link href="/residents" className="text-small font-semibold text-accent-text underline-offset-4 hover:underline">
        ← {t('console.residents.back')}
      </Link>
      <div className="flex flex-col gap-1">
        <h1 className="font-display text-h1 font-bold">{data.fullName ?? t('console.residents.noName')}</h1>
        <p className="text-text-muted">
          {home}
          {data.city ? ` · ${data.city}` : ''}
        </p>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="flex flex-col gap-2 rounded-panel">
          <span className="font-mono">{data.phone ?? '—'}</span>
          <span className="text-small text-text-muted">{t('console.residents.phoneNote')}</span>
          <span className="text-small">
            {data.role === 'owner' ? t('console.residents.owner') : t('console.residents.member')} · {t('console.residents.household', { count: data.householdSize })}
          </span>
        </Card>

        {!medical ? (
          <Card className="flex flex-col gap-2 rounded-panel">
            <h2 className="font-display text-title font-bold">{t('console.residents.medical')}</h2>
            <p className="text-small text-text-muted">{t(`console.residents.medical_${data.medicalAccess}`)}</p>
          </Card>
        ) : null}
      </div>

      {medical ? (
        <section className="flex flex-col gap-3" aria-labelledby="medical-heading">
          <h2 id="medical-heading" className="font-display text-h3 font-bold">
            {t('console.residents.medical')}
          </h2>
          <MedicalSection data={medical} />
        </section>
      ) : null}

      {data.consents ? (
        <Card className="flex flex-col gap-3 rounded-panel">
          <div>
            <h2 className="font-display text-title font-bold">{t('console.residents.consents')}</h2>
            <p className="text-small text-text-muted">{t('console.residents.consentsNote')}</p>
          </div>
          <ul className="flex flex-col divide-y divide-border">
            {data.consents
              .filter((c) => c.purpose !== 'manager' && c.purpose !== 'doctor_share')
              .map((c) => (
                <li key={`${c.purpose}-${c.scopeKey}`} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
                  <span>{t(`consent.${c.purpose}.title`)}</span>
                  <span className={cn('rounded-pill px-2.5 py-1 text-caption font-bold', c.status === 'granted' ? 'bg-success-soft text-success-text' : 'bg-surface-raised text-text-muted')}>
                    {t(`console.residents.status.${c.status}`)}
                    {c.outdated ? ` · ${t('console.residents.outdated')}` : ''}
                  </span>
                </li>
              ))}
          </ul>
        </Card>
      ) : null}

      <p className="text-caption text-text-muted">{t('console.residents.viewLogged')}</p>
    </>
  );
}
