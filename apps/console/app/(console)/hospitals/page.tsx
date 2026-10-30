import { createI18n } from '@repo/i18n';
import { Button, Card, cn } from '@repo/ui-web';
import { serverApi } from '@/lib/api';
import { ActionForm } from '../_coverage/action-form';
import { addHospital, updateHospital } from '../_handover/actions';

const field = 'min-h-tap rounded-control border border-border-strong bg-surface px-3 text-text';
const when = new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Kolkata' });

// Network hospitals (plan §10): super admin and operations (the API checks).
export default async function HospitalsPage() {
  const { t } = createI18n('en');
  const api = await serverApi();
  const { data, response } = await api.GET('/v1/hospitals');

  return (
    <>
      <div className="flex max-w-3xl flex-col gap-2">
        <h1 className="font-display text-h1 font-bold">{t('console.hospitals.title')}</h1>
        <p className="text-text-muted">{t('console.hospitals.intro')}</p>
      </div>

      {!data ? (
        <Card role="alert" className="text-danger-text">
          {response.status === 403 ? t('console.notStaff') : t('console.genericError')}
        </Card>
      ) : (
        <>
          <Card className="flex flex-col gap-3 rounded-panel p-5">
            <h2 className="font-display text-title font-bold">{t('console.hospitals.add')}</h2>
            <ActionForm
              action={addHospital}
              reset
              label={t('console.hospitals.add')}
              doneText={t('console.hospitals.saved')}
              className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3"
            >
              <label className="flex flex-col gap-1 text-small font-semibold">
                {t('console.hospitals.name')}
                <input name="name" required maxLength={120} className={field} />
              </label>
              <label className="flex flex-col gap-1 text-small font-semibold">
                {t('console.hospitals.address')}
                <input name="address" maxLength={200} className={field} />
              </label>
              <label className="flex flex-col gap-1 text-small font-semibold">
                {t('console.hospitals.city')}
                <input name="city" maxLength={80} className={field} />
              </label>
              <label className="flex flex-col gap-1 text-small font-semibold">
                {t('console.hospitals.lat')}
                <input name="lat" type="number" step="any" min={6} max={37.5} required className={field} />
              </label>
              <label className="flex flex-col gap-1 text-small font-semibold">
                {t('console.hospitals.lng')}
                <input name="lng" type="number" step="any" min={68} max={97.5} required className={field} />
              </label>
              <label className="flex flex-col gap-1 text-small font-semibold">
                {t('console.hospitals.erPhone')}
                <input name="erPhone" type="tel" required pattern="\+91\d{10}" placeholder="+91" className={field} />
              </label>
              <div className="sm:col-span-2 lg:col-span-3">
                <Button type="submit">{t('console.hospitals.save')}</Button>
              </div>
            </ActionForm>
          </Card>

          {data.hospitals.length === 0 ? (
            <Card className="text-text-muted">{t('console.hospitals.empty')}</Card>
          ) : (
            <ul className="flex flex-col gap-3" data-testid="hospitals">
              {data.hospitals.map((h) => (
                <li key={h.id}>
                  <Card className={cn('flex flex-wrap items-center gap-x-4 gap-y-2 rounded-card p-4', !h.active && 'opacity-70')}>
                    <div className="flex min-w-56 flex-1 flex-col">
                      <span className="font-semibold">{h.name}</span>
                      <span className="text-small text-text-muted">{[h.address, h.city, h.erPhone].filter(Boolean).join(' · ')}</span>
                    </div>
                    <span
                      className={cn(
                        'rounded-pill px-2.5 py-1 text-caption font-bold',
                        !h.active
                          ? 'bg-surface-raised text-text-muted'
                          : h.hasCapacity
                            ? 'bg-success-soft text-success-text'
                            : 'bg-warning-soft text-warning-text',
                      )}
                    >
                      {!h.active ? t('console.hospitals.inactive') : h.hasCapacity ? t('console.hospitals.accepting') : t('console.hospitals.full')}
                    </span>
                    {h.capacityUpdatedAt ? (
                      <span className="text-caption text-text-muted">
                        {t('console.hospitals.updated', { time: when.format(new Date(h.capacityUpdatedAt)) })}
                      </span>
                    ) : null}
                    <div className="flex gap-2">
                      {h.active ? (
                        <ActionForm action={updateHospital.bind(null, h.id, { hasCapacity: !h.hasCapacity })}>
                          <Button type="submit" variant="outline">
                            {h.hasCapacity ? t('console.hospitals.markFull') : t('console.hospitals.markAccepting')}
                          </Button>
                        </ActionForm>
                      ) : null}
                      <ActionForm action={updateHospital.bind(null, h.id, { active: !h.active })}>
                        <Button type="submit" variant="ghost">
                          {h.active ? t('console.hospitals.deactivate') : t('console.hospitals.activate')}
                        </Button>
                      </ActionForm>
                    </div>
                  </Card>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </>
  );
}
