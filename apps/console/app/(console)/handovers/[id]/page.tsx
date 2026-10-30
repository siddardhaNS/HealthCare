import Link from 'next/link';
import { createI18n } from '@repo/i18n';
import { Button, Card, cn } from '@repo/ui-web';
import { serverApi } from '@/lib/api';
import { HandoverRecordView } from '@/app/ui/handover-record';
import { ActionForm } from '../../_coverage/action-form';
import { statePill } from '../../_command/incident-panel';
import { confirmHandover } from '../../_handover/actions';

const clock = new Intl.DateTimeFormat('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Kolkata' });

// One incoming patient: the consented record and "Confirm patient received".
// Every opening is logged by the API in record_shares.
export default async function HandoverDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { t } = createI18n('en');
  const api = await serverApi();
  const { data, error, response } = await api.GET('/v1/partner/handovers/{id}', { params: { path: { id } } });
  const back = (
    <Link href="/handovers" className="text-small font-semibold text-accent-text underline">
      ← {t('console.partner.back')}
    </Link>
  );

  if (!data) {
    return (
      <>
        {back}
        <Card role="alert" className="text-danger-text">
          {response.status === 404 || response.status === 403 ? (error?.error?.message ?? t('console.notStaff')) : t('console.genericError')}
        </Card>
      </>
    );
  }

  return (
    <>
      {back}
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="font-mono text-h1 font-bold">{data.ref}</h1>
        {data.isDrill ? <span className="rounded-pill bg-info-soft px-2.5 py-1 text-caption font-bold text-info-text">{t('console.cc.drill')}</span> : null}
        <span className={cn('rounded-pill px-2.5 py-1 text-caption font-bold', statePill(data.state))}>{t(`console.cc.state.${data.state}`)}</span>
      </div>

      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <Card className="flex flex-col gap-3 rounded-panel p-5">
          <div className="flex flex-col gap-1">
            <h2 className="font-display text-title font-bold">{t('console.partner.record')}</h2>
            <p className="text-small text-text-muted">{t('console.partner.recordNote')}</p>
          </div>
          {data.record ? <HandoverRecordView r={data.record} t={t} /> : <p className="text-text-muted">{t('console.partner.expired')}</p>}
        </Card>

        <Card className="flex flex-col gap-3 rounded-panel p-5">
          <span className="text-caption font-bold uppercase text-text-muted">{t('console.cc.ambulance')}</span>
          {data.ambulance ? (
            <>
              <span className="font-mono font-semibold">{data.ambulance.registration}</span>
              <a href={`tel:${data.ambulance.workPhone}`} className="text-small font-semibold text-accent-text underline">
                {t('console.partner.callAmbulance')} {data.ambulance.workPhone}
              </a>
            </>
          ) : null}
          <span className={cn('font-semibold', data.arrivalEtaS !== null ? 'text-danger-text' : 'text-text-muted')}>
            {data.arrivalEtaS !== null
              ? t('console.partner.eta', { min: Math.max(1, Math.round(data.arrivalEtaS / 60)) })
              : data.state === 'handed_over' || data.state === 'closed'
                ? t('console.partner.arrived')
                : t('console.partner.etaUnknown')}
          </span>
          {data.confirmedAt ? (
            <p className="font-semibold text-success-text" data-testid="confirmed">
              {t('console.partner.confirmed', { time: clock.format(new Date(data.confirmedAt)) })}
            </p>
          ) : data.state !== 'cancelled' ? (
            <ActionForm action={confirmHandover.bind(null, data.id)} label={t('console.partner.confirm')}>
              <Button type="submit" variant="accent" className="w-full" data-testid="confirm-receipt">
                {t('console.partner.confirm')}
              </Button>
            </ActionForm>
          ) : null}
        </Card>
      </div>
    </>
  );
}
