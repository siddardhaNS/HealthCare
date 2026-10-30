import Link from 'next/link';
import { createI18n } from '@repo/i18n';
import { Button, Card, buttonVariants, cn } from '@repo/ui-web';
import { serverApi } from '@/lib/api';
import { ActionForm } from '../_coverage/action-form';
import { statePill } from '../_command/incident-panel';
import { setCapacity } from '../_handover/actions';
import { AutoRefresh } from '../_handover/refresh';

const clock = new Intl.DateTimeFormat('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Kolkata' });

// Partner portal, hospitals (plan §6, §10): incoming SOS patients with arrival
// ETA, and the ER's capacity switch. The API scopes it to the user's hospital.
export default async function IncomingPatients() {
  const { t } = createI18n('en');
  const api = await serverApi();
  const { data, error, response } = await api.GET('/v1/partner/handovers');
  const header = <h1 className="font-display text-h1 font-bold">{t('console.partner.title')}</h1>;

  if (!data) {
    return (
      <>
        {header}
        <Card role="alert" className="text-danger-text">
          {response.status === 403 ? (error?.error?.message ?? t('console.notStaff')) : t('console.genericError')}
        </Card>
      </>
    );
  }

  const full = !data.hospital.hasCapacity;
  return (
    <>
      <AutoRefresh seconds={15} />
      <div className="flex flex-col gap-1">
        {header}
        <p className="text-text-muted">{t('console.partner.subtitle', { hospital: data.hospital.name })}</p>
      </div>

      <Card className={cn('flex flex-wrap items-center gap-4 rounded-panel p-5', full && 'border-warning-border')} data-testid="capacity">
        <div className="flex flex-1 flex-col">
          <span className="text-caption font-bold uppercase text-text-muted">{t('console.partner.capacity')}</span>
          <span className={cn('font-semibold', full ? 'text-warning-text' : 'text-success-text')}>
            {full ? t('console.partner.full') : t('console.partner.accepting')}
          </span>
        </div>
        <ActionForm action={setCapacity.bind(null, full)} label={t('console.partner.capacity')}>
          <Button type="submit" variant={full ? 'accent' : 'outline'} data-testid="toggle-capacity">
            {full ? t('console.partner.setAccepting') : t('console.partner.setFull')}
          </Button>
        </ActionForm>
      </Card>

      {data.handovers.length === 0 ? (
        <Card className="text-text-muted">{t('console.partner.empty')}</Card>
      ) : (
        <ul className="flex flex-col gap-3" data-testid="handovers">
          {data.handovers.map((h) => (
            <li key={h.id}>
              <Card className={cn('flex flex-wrap items-center gap-x-4 gap-y-2 rounded-card p-4', !h.confirmedAt && !h.expired && 'border-danger-border')}>
                <span className="font-mono font-bold">{h.ref}</span>
                {h.isDrill ? (
                  <span className="rounded-pill bg-info-soft px-2.5 py-1 text-caption font-bold text-info-text">{t('console.cc.drill')}</span>
                ) : null}
                <span className={cn('rounded-pill px-2.5 py-1 text-caption font-bold', statePill(h.state))}>{t(`console.cc.state.${h.state}`)}</span>
                <span className="flex-1 text-small">
                  {h.arrivalEtaS !== null ? (
                    <span className="font-semibold text-danger-text">{t('console.partner.eta', { min: Math.max(1, Math.round(h.arrivalEtaS / 60)) })}</span>
                  ) : h.state === 'handed_over' || h.state === 'closed' ? (
                    t('console.partner.arrived')
                  ) : (
                    <span className="text-text-muted">{t('console.partner.etaUnknown')}</span>
                  )}
                  {h.ambulance ? <span className="text-text-muted"> · {h.ambulance.registration}</span> : null}
                </span>
                {h.confirmedAt ? (
                  <span className="text-small font-semibold text-success-text">
                    {t('console.partner.confirmed', { time: clock.format(new Date(h.confirmedAt)) })}
                  </span>
                ) : null}
                <Link href={`/handovers/${h.id}`} className={buttonVariants({ variant: h.confirmedAt || h.expired ? 'outline' : 'accent' })}>
                  {t('console.partner.open')}
                </Link>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
