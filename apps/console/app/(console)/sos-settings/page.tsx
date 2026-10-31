import { sosThresholds } from '@repo/contracts/sos';
import { createI18n } from '@repo/i18n';
import { Button, Card, cn } from '@repo/ui-web';
import { serverApi } from '@/lib/api';
import { ActionForm } from '../_coverage/action-form';
import { saveThresholds } from '../_coverage/actions';

const input = 'min-h-tap w-24 rounded-control border border-border-strong bg-surface px-3 text-text tabular-nums';

// SOS timeout per community (plan ⚑2, §11): seconds before the next crew is offered. Everyone who runs the
// command center can see them; only a super admin changes them (the API checks).
export default async function SosSettingsPage() {
  const { t } = createI18n('en');
  const api = await serverApi();
  const { data, response } = await api.GET('/v1/sos-settings');

  return (
    <>
      <div className="flex max-w-3xl flex-col gap-2">
        <h1 className="font-display text-h1 font-bold">{t('console.thresholds.title')}</h1>
        <p className="text-text-muted">{t('console.thresholds.intro')}</p>
        <p className="text-small text-text-muted">
          {t('console.thresholds.bounds', { wmin: sosThresholds.widenMin, wmax: sosThresholds.widenMax })}
        </p>
      </div>
      {!data ? (
        <Card role="alert" className="text-danger-text">
          {response.status === 403 ? t('console.notStaff') : t('console.genericError')}
        </Card>
      ) : data.sites.length === 0 ? (
        <Card className="text-text-muted">{t('console.thresholds.empty')}</Card>
      ) : (
        <>
          {!data.canEdit ? <p className="text-small text-text-muted">{t('console.thresholds.readOnly')}</p> : null}
          <ul className="flex flex-col gap-3" data-testid="thresholds">
            {data.sites.map((s) => (
              <li key={s.siteId}>
                <Card className="flex flex-col gap-3 rounded-panel p-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="flex-1 font-display text-title font-bold">
                      {s.name} <span className="text-small font-normal text-text-muted">· {s.city}</span>
                    </h2>
                    <span className={cn('rounded-pill px-2.5 py-1 text-caption font-bold', s.custom ? 'bg-info-soft text-info-text' : 'bg-surface-raised text-text-muted')}>
                      {s.custom ? t('console.thresholds.custom') : t('console.thresholds.defaults')}
                    </span>
                  </div>
                  {data.canEdit ? (
                    <ActionForm action={saveThresholds.bind(null, s.siteId)} doneText={t('console.thresholds.saved')} label={s.name} className="flex flex-wrap items-end gap-4">
                      <label className="flex flex-col gap-1 text-small font-semibold">
                        {t('console.thresholds.widen')}
                        <input type="number" name="widenAfterS" required min={sosThresholds.widenMin} max={sosThresholds.widenMax} defaultValue={s.widenAfterS} className={input} />
                      </label>
                      <label className="flex flex-col gap-1 text-small font-semibold">
                        {t('console.thresholds.gatePhone')}
                        <input type="tel" name="gatePhone" inputMode="tel" placeholder="+91XXXXXXXXXX" pattern="\+91[6-9]\d{9}" defaultValue={s.gatePhone ?? ''} className={cn(input, 'w-48')} />
                      </label>
                      <Button type="submit" variant="outline">
                        {t('console.thresholds.save')}
                      </Button>
                    </ActionForm>
                  ) : (
                    <dl className="flex flex-wrap gap-6 text-small">
                      <div>
                        <dt className="text-text-muted">{t('console.thresholds.widen')}</dt>
                        <dd className="font-mono text-title">{s.widenAfterS}</dd>
                      </div>
                      <div>
                        <dt className="text-text-muted">{t('console.thresholds.gatePhone')}</dt>
                        <dd className="font-mono text-title">{s.gatePhone ?? t('console.thresholds.gateNone')}</dd>
                      </div>
                    </dl>
                  )}
                </Card>
              </li>
            ))}
          </ul>
        </>
      )}
    </>
  );
}
