import type { DeskIncidentDetail, FleetCrew } from '@repo/contracts';
import { distanceM, isOpen, type SosState } from '@repo/contracts/sos';
import type { createI18n } from '@repo/i18n';
import { Button, Card, cn } from '@repo/ui-web';
import { cancelSos, closeSos, handOverSos, offerSos, reassignSos } from './actions';
import { redirectHospital } from '../_handover/actions';
import { DeskAction } from './forms';
import { Since } from './live';

type TFunction = ReturnType<typeof createI18n>['t'];

/** Wall-clock times for staff in India. */
const clock = new Intl.DateTimeFormat('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false, timeZone: 'Asia/Kolkata' });

export function statePill(state: SosState) {
  if (state === 'escalated_to_108' || state === 'dispatching' || state === 'raised') return 'bg-danger-soft text-danger-text';
  if (state === 'handed_over' || state === 'closed') return 'bg-success-soft text-success-text';
  if (state === 'cancelled') return 'bg-surface-raised text-text-muted';
  return 'bg-warning-soft text-warning-text';
}

export function homeLine(i: DeskIncidentDetail['resident'], t: TFunction) {
  const unit = [i.tower, i.number].filter(Boolean).join('-');
  return [i.community ?? t('console.cc.standalone'), unit, i.city].filter(Boolean).join(' · ');
}

/** Free crews the desk can offer this incident to, nearest first when positions are known. */
function freeCrews(i: DeskIncidentDetail, fleet: FleetCrew[], t: TFunction) {
  return fleet
    .filter((c) => c.onDuty && !c.incidentId && (!i.isDrill || c.drillParticipant))
    .map((c) => ({ c, m: c.position && i.location ? distanceM(c.position, i.location) : null }))
    .sort((a, b) => (a.m ?? Infinity) - (b.m ?? Infinity))
    .map(({ c, m }) => ({
      id: c.crewId,
      label: [c.registration ?? t('console.cc.noVehicle'), c.name ?? t('console.cc.unnamedCrew'), c.team, m !== null ? t('console.cc.scale', { km: (m / 1000).toFixed(1) }) : null].filter(Boolean).join(' · '),
    }));
}

/** Where the patient goes and which items were shared, never their contents (the desk sees no medical detail). */
function HandoverBox({ i, t }: { i: DeskIncidentDetail; t: TFunction }) {
  const h = i.handover;
  const waiting = ['raised', 'dispatching', 'escalated_to_108'].includes(i.state);
  return (
    <div className="flex flex-col gap-1 rounded-control border border-border bg-surface-raised p-3" data-testid="handover">
      <span className="text-caption font-bold uppercase text-text-muted">{t('console.cc.handoverTitle')}</span>
      {h ? (
        <>
          <span className="font-semibold">{h.hospital.name}</span>
          <span className="text-small text-text-muted">
            {[t(`console.cc.chosenBy.${h.chosenBy}`), h.preferred ? t('console.cc.handoverPreferred') : null].filter(Boolean).join(' · ')}
          </span>
          {h.reason ? <span className="text-small text-text-muted">“{h.reason}”</span> : null}
          <span className="text-small">{t('console.cc.handoverItems', { items: h.items.map((x) => t(`console.handoverItems.${x}`)).join(', ') })}</span>
          <span className={cn('text-small font-semibold', h.confirmedAt ? 'text-success-text' : 'text-warning-text')}>
            {h.confirmedAt ? t('console.cc.handoverConfirmed', { time: clock.format(new Date(h.confirmedAt)) }) : t('console.cc.handoverUnconfirmed')}
          </span>
          <span className="text-caption text-text-muted">{t('console.cc.handoverLink', { time: clock.format(new Date(h.expiresAt)) })}</span>
          <a href={`tel:${h.hospital.erPhone}`} className="text-small font-semibold text-accent-text underline">
            {t('console.cc.callEr')} {h.hospital.erPhone}
          </a>
        </>
      ) : (
        <span className={cn('text-small', !i.isDrill && !waiting && isOpen(i.state) ? 'text-warning-text' : 'text-text-muted')}>
          {i.isDrill
            ? t('console.cc.handoverDrill')
            : waiting
              ? t('console.cc.handoverWaiting')
              : isOpen(i.state)
                ? t('console.cc.handoverNone')
                : t('console.partner.none')}
        </span>
      )}
    </div>
  );
}

export function IncidentPanel({ i, fleet, canAct, t }: { i: DeskIncidentDetail; fleet: FleetCrew[]; canAct: boolean; t: TFunction }) {
  const open = isOpen(i.state);
  const labels = { confirm: t('console.cc.confirm'), saving: t('console.cc.saving'), reason: t('console.cc.reason'), reasonOptional: t('console.cc.reasonOptional') };
  const crews = freeCrews(i, fleet, t);
  const crewPicker = (optional: boolean) => ({ options: crews, label: optional ? t('console.cc.offerTo') : t('console.cc.chooseCrew'), none: optional ? t('console.cc.offerToNone') : undefined, emptyText: t('console.cc.noFreeCrews') });
  const a = i.actions;

  return (
    <Card aria-labelledby="incident-title" className={cn('flex min-w-0 flex-col gap-4 rounded-card p-5', open && 'border-danger-border')} data-testid="incident-panel">
      <div className="flex flex-wrap items-center gap-2">
        <span id="incident-title" className="font-mono text-title font-bold">
          {i.ref}
        </span>
        {i.isDrill ? <span className="rounded-pill bg-info-soft px-2.5 py-1 text-caption font-bold text-info-text">{t('console.cc.drill')}</span> : null}
        <span className={cn('rounded-pill px-2.5 py-1 text-caption font-bold', statePill(i.state))} data-testid="incident-state">
          {t(`console.cc.state.${i.state}`)}
        </span>
        <span className="ml-auto text-small text-text-muted">{open ? <Since iso={i.createdAt} template={t('console.cc.openFor', { time: '{{time}}' })} /> : i.closedAt ? clock.format(new Date(i.closedAt)) : null}</span>
      </div>

      <div className="flex flex-col gap-1">
        <h2 className="font-display text-h3 font-bold">{i.isDrill ? t('console.cc.drillResident') : (i.resident.name ?? t('console.cc.noName'))}</h2>
        <p className="text-small text-text-muted">{homeLine(i.resident, t)}</p>
        {!i.location ? <p className="text-small text-warning-text">{t('console.cc.noLocation')}</p> : null}
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-1 rounded-control border border-border bg-surface-raised p-3">
          <span className="text-caption font-bold uppercase text-text-muted">{t('console.cc.ambulance')}</span>
          {i.crew ? (
            <>
              <span className="font-mono font-semibold">{i.crew.ambulance?.registration ?? t('console.cc.noVehicle')}</span>
              <span className="text-small">{[i.crew.name ?? t('console.cc.unnamedCrew'), i.crew.team].filter(Boolean).join(' · ')}</span>
              <span className="text-small font-semibold text-danger-text">
                {i.crew.etaS !== null && i.crew.distanceM !== null ? t('console.cc.eta', { min: Math.max(1, Math.round(i.crew.etaS / 60)), km: (i.crew.distanceM / 1000).toFixed(1) }) : t('console.cc.etaUnknown')}
              </span>
            </>
          ) : (
            <span className="text-small text-text-muted">{t('console.cc.noCrew')}</span>
          )}
        </div>
        <HandoverBox i={i} t={t} />
      </div>

      {open && canAct ? (
        <div className="grid gap-2 sm:grid-cols-2">
          {i.crew?.workPhone ? (
            <Button asChild variant="danger">
              <a href={`tel:${i.crew.workPhone}`} aria-label={`${t('console.cc.callCrew')} ${i.crew.workPhone}`}>
                {t('console.cc.callCrew')}
              </a>
            </Button>
          ) : null}
          {a.offer ? (
            <DeskAction
              testId="act-offer"
              action={offerSos.bind(null, i.id)}
              label={t('console.cc.offer')}
              hint={t('console.cc.offerHint')}
              labels={labels}
              reason="none"
              crews={crewPicker(false)}
            />
          ) : null}
          {a.reassign ? (
            <DeskAction
              testId="act-reassign"
              action={reassignSos.bind(null, i.id)}
              label={t('console.cc.reassign')}
              hint={t('console.cc.reassignHint')}
              labels={labels}
              reason="required"
              crews={crewPicker(true)}
            />
          ) : null}
          {a.handOver ? (
            <DeskAction
              testId="act-hand-over"
              action={handOverSos.bind(null, i.id)}
              label={t('console.cc.handOver')}
              hint={t('console.cc.handOverHint')}
              labels={labels}
              reason="required"
            />
          ) : null}
          {!i.isDrill && i.hospitalsNearby.length > 0 ? (
            <DeskAction
              testId="act-hospital"
              action={redirectHospital.bind(null, i.id)}
              label={i.handover ? t('console.cc.hospitalChange') : t('console.cc.hospitalChoose')}
              hint={t('console.cc.hospitalHint')}
              labels={labels}
              reason="required"
              crews={{
                name: 'hospitalId',
                label: t('console.cc.hospitalPick'),
                emptyText: t('console.cc.noHospitals'),
                options: i.hospitalsNearby
                  .filter((h) => h.id !== i.handover?.hospital.id)
                  .map((h) => ({
                    id: h.id,
                    label: [
                      h.name,
                      h.etaS !== null ? t('console.cc.hospitalEta', { min: Math.max(1, Math.round(h.etaS / 60)) }) : null,
                      h.hasCapacity ? null : t('console.cc.hospitalFull'),
                    ]
                      .filter(Boolean)
                      .join(' · '),
                  })),
              }}
            />
          ) : null}
          {a.close ? (
            <DeskAction testId="act-close" action={closeSos.bind(null, i.id)} label={t('console.cc.close')} hint={a.closeNeedsReason ? t('console.cc.closeHintReason') : t('console.cc.closeHint')} labels={labels} reason={a.closeNeedsReason ? 'required' : 'optional'} />
          ) : null}
          {a.cancel ? <DeskAction testId="act-cancel" action={cancelSos.bind(null, i.id)} label={t('console.cc.cancel')} hint={t('console.cc.cancelHint')} labels={labels} reason="required" variant="danger" /> : null}
        </div>
      ) : open ? (
        <p className="text-small text-text-muted">{t('console.cc.watchOnly')}</p>
      ) : null}

      <section aria-labelledby="timeline-title" className="flex flex-col gap-2">
        <h3 id="timeline-title" className="font-display text-body font-bold">
          {t('console.cc.timeline')}
        </h3>
        <ol className="flex flex-col gap-2 border-l-2 border-border pl-4">
          {i.timeline.map((e, n) => (
            <li key={n} className="flex flex-col">
              <span className="text-small">
                <span className="font-mono text-text-muted">{clock.format(new Date(e.at))}</span> · <span className="font-semibold">{t(`console.cc.state.${e.to}`)}</span> · {t(`console.cc.by.${e.by}`)}
              </span>
              {e.reason ? <span className="text-small text-text-muted">“{e.reason}”</span> : null}
            </li>
          ))}
        </ol>
      </section>

      <section aria-labelledby="offers-title" className="flex flex-col gap-2">
        <h3 id="offers-title" className="font-display text-body font-bold">
          {t('console.cc.offers')}
        </h3>
        {i.offers.length === 0 ? (
          <p className="text-small text-text-muted">{t('console.cc.noOffers')}</p>
        ) : (
          <ul className="flex flex-col divide-y divide-border">
            {i.offers.map((o) => (
              <li key={o.crewId} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2 text-small">
                <span className="font-mono">{o.registration ?? t('console.cc.noVehicle')}</span>
                <span className="flex-1">{o.crewName ?? t('console.cc.unnamedCrew')}</span>
                <span className="text-text-muted">{t(`console.cc.ring.r${Math.min(o.ring, 2)}`)}</span>
                <span className={cn('rounded-pill px-2 py-0.5 text-caption font-bold', o.response === 'accepted' ? 'bg-success-soft text-success-text' : o.response ? 'bg-surface-raised text-text-muted' : 'bg-warning-soft text-warning-text')}>
                  {t(`console.cc.response.${o.response ?? 'pending'}`)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </Card>
  );
}
