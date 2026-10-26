import Link from 'next/link';
import { revalidatePath } from 'next/cache';
import { leadStatuses, type Lead } from '@repo/contracts';
import { createI18n } from '@repo/i18n';
import { Button, Card, cn } from '@repo/ui-web';
import { serverApi } from '@/lib/api';

type Status = Lead['status'];

async function setStatus(form: FormData) {
  'use server';
  const api = await serverApi();
  await api.PATCH('/v1/leads/{id}', { params: { path: { id: String(form.get('id')) } }, body: { status: form.get('status') as Status } });
  revalidatePath('/leads');
}

// Landing-site sign-ups. Visible to super admin and operations (enforced by the API).
export default async function LeadsPage({ searchParams }: { searchParams: Promise<{ status?: string; focus?: string }> }) {
  const { status, focus } = await searchParams;
  const { t } = createI18n('en');
  const filter = (leadStatuses as readonly string[]).includes(status ?? '') ? (status as Status) : undefined;
  const api = await serverApi();
  const { data, response } = await api.GET('/v1/leads', { params: { query: { status: filter } } });

  return (
    <>
      <h1 className="font-display text-h1 font-bold">{t('console.leads.title')}</h1>
      <nav aria-label={t('console.leads.filter')} className="flex flex-wrap gap-2">
        {[undefined, ...leadStatuses].map((s) => (
          <Link
            key={s ?? 'all'}
            href={s ? `/leads?status=${s}` : '/leads'}
            aria-current={filter === s ? 'page' : undefined}
            className={cn('min-h-tap rounded-pill border px-4 py-2 text-small font-semibold', filter === s ? 'border-accent bg-accent-soft text-accent-text' : 'border-border text-text-muted')}
          >
            {s ? t(`console.leads.status.${s}`) : t('console.leads.all')}
          </Link>
        ))}
      </nav>

      {!data ? (
        <Card role="alert" className="text-danger-text">
          {response.status === 403 ? t('console.notStaff') : t('console.genericError')}
        </Card>
      ) : data.leads.length === 0 ? (
        <Card className="text-text-muted">{t('console.leads.empty')}</Card>
      ) : (
        <ul className="flex flex-col gap-3">
          {data.leads.map((l) => (
            <li key={l.id}>
              <Card className={cn('flex flex-col gap-3 rounded-panel', focus === l.id && 'border-accent')}>
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="font-display text-title font-bold">{l.orgName ?? l.contactName}</span>
                  <span className="font-mono text-small text-text-muted">{l.ref}</span>
                </div>
                <p className="text-small text-text-muted">
                  {[t(`console.leads.orgType.${l.orgType}`), l.area, l.city, `${l.size}`].filter(Boolean).join(' · ')}
                </p>
                <p className="text-small">
                  {l.contactName} · <a className="text-accent-text underline" href={`tel:${l.phone}`}>{l.phone}</a> ·{' '}
                  <a className="text-accent-text underline" href={`mailto:${l.email}`}>{l.email}</a>
                </p>
                {l.notes ? <p className="text-small text-text-muted">{l.notes}</p> : null}
                <form action={setStatus} className="flex flex-wrap items-center gap-2">
                  <input type="hidden" name="id" value={l.id} />
                  <label className="text-small font-semibold text-text-muted" htmlFor={`s-${l.id}`}>
                    {t('console.leads.statusLabel')}
                  </label>
                  <select id={`s-${l.id}`} name="status" defaultValue={l.status} className="min-h-tap rounded-control border border-border-strong bg-surface px-3 text-text">
                    {leadStatuses.map((s) => (
                      <option key={s} value={s}>
                        {t(`console.leads.status.${s}`)}
                      </option>
                    ))}
                  </select>
                  <Button type="submit" variant="outline">
                    {t('console.leads.save')}
                  </Button>
                </form>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
