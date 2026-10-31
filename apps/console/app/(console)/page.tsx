import Link from 'next/link';
import { redirect } from 'next/navigation';
import type { DeskIncident, FleetCrew } from '@repo/contracts';
import { sosRef } from '@repo/contracts/sos';
import { createI18n } from '@repo/i18n';
import { Card, cn } from '@repo/ui-web';
import { serverApi } from '@/lib/api';
import { getStaffClaims } from '@/lib/supabase/server';
import { runTestSos } from './_command/actions';
import { TestSosForm } from './_command/forms';
import { IncidentPanel, homeLine, statePill } from './_command/incident-panel';
import { LiveBoard, Since } from './_command/live';
import { EmergencyMap } from './_command/map';

/** See every community (desk:all); the community desk listens to its own. */
const allSites = ['super_admin', 'operations', 'support'];
const canActRoles = ['super_admin', 'operations', 'community_desk'];
const deskRoles = ['super_admin', 'operations', 'support', 'community_desk'];

// Command center (plan §6): live emergency map, the selected incident with its
// timeline and actions, test SOS, fleet. What each role sees is decided by
// the API; this page only lays it out. Medical details never appear here.
export default async function CommandCenter({ searchParams }: { searchParams: Promise<{ incident?: string }> }) {
  const { incident: picked } = await searchParams;
  const { t } = createI18n('en');
  const claims = await getStaffClaims();
  const roles: string[] = claims?.roles ?? [];
  // Hospital partner staff have their own home: incoming patients.
  if (roles.includes('hospital') && !roles.some((r) => deskRoles.includes(r))) redirect('/handovers');
  const api = await serverApi();
  const [open, recent, fleet, sites] = await Promise.all([
    api.GET('/v1/desk/sos', { params: { query: { view: 'open' } } }),
    api.GET('/v1/desk/sos', { params: { query: { view: 'recent' } } }),
    api.GET('/v1/desk/fleet'),
    api.GET('/v1/desk/sites'),
  ]);

  const header = <h1 className="font-display text-h1 font-bold">{t('console.commandCenter')}</h1>;
  if (!open.data || !recent.data || !fleet.data || !sites.data) {
    return (
      <>
        {header}
        <Card role="alert" className="text-danger-text">
          {open.response.status === 403 ? t('console.notStaff') : t('console.genericError')}
        </Card>
      </>
    );
  }

  const incidents = open.data.incidents;
  const crews = fleet.data.crews;
  const selectedId = picked ?? incidents[0]?.id ?? null;
  const detail = selectedId ? (await api.GET('/v1/desk/sos/{id}', { params: { path: { id: selectedId } } })).data : undefined;
  const canAct = roles.some((r) => canActRoles.includes(r));
  const topics = roles.some((r) => allSites.includes(r)) ? ['desk:all'] : sites.data.sites.map((s) => `desk:${s.id}`);
  const onDuty = crews.filter((c) => c.onDuty).length;

  return (
    <>
      <div className="flex flex-col gap-3">
        <div className="flex flex-col gap-1">
          {header}
          <p className="text-text-muted">{t('console.cc.subtitle')}</p>
        </div>
        <LiveBoard
          topics={topics}
          labels={{
            live: t('console.cc.live'),
            connecting: t('console.cc.connecting'),
            paused: t('console.cc.livePaused'),
            soundOn: t('console.cc.soundOn'),
            soundOff: t('console.cc.soundOff'),
            dismiss: t('console.cc.dismiss'),
            alarm: {
              raised: t('console.cc.alarm.raised', { ref: '{{ref}}' }),
              no_accept: t('console.cc.alarm.no_accept', { ref: '{{ref}}' }),
              no_accept_team: t('console.cc.alarm.no_accept_team', { ref: '{{ref}}', missed: '{{missed}}', next: '{{next}}' }),
              no_accept_nearest: t('console.cc.alarm.no_accept_nearest', { ref: '{{ref}}', missed: '{{missed}}' }),
              no_hospital: t('console.cc.alarm.no_hospital', { ref: '{{ref}}' }),
            },
          }}
        />
      </div>

      <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <EmergencyMap
          incidents={incidents}
          crews={crews}
          selectedId={selectedId}
          labels={{
            title: t('console.cc.map'),
            a11y: t('console.cc.mapA11y', { incidents: incidents.length, crews: crews.filter((c) => c.onDuty && c.position).length }),
            note: t('console.cc.mapNote'),
            empty: t('console.cc.mapEmpty'),
            sos: t('console.cc.legendSos'),
            free: t('console.cc.legendFree'),
            busy: t('console.cc.legendBusy'),
            drill: t('console.cc.drill'),
            scale: t('console.cc.scale', { km: '{{km}}' }),
          }}
        />
        {detail ? (
          <div className="flex flex-col gap-3">
            {picked && !incidents.some((i) => i.id === picked) ? (
              <Link href="/" className="text-small font-semibold text-accent-text underline-offset-4 hover:underline">
                ← {t('console.cc.back')}
              </Link>
            ) : null}
            <IncidentPanel i={detail} fleet={crews} canAct={canAct} t={t} />
          </div>
        ) : (
          <Card className="flex flex-col items-start gap-3 rounded-card p-5" data-testid="all-clear">
            <span className="rounded-pill bg-success-soft px-2.5 py-1 text-caption font-bold text-success-text">{t('console.cc.allClear')}</span>
            <h2 className="font-display text-h3 font-bold">{t('console.cc.noneTitle')}</h2>
            <p className="text-small text-text-muted">{t('console.cc.noneBody', { count: onDuty })}</p>
            {canAct ? (
              <div className="flex w-full flex-col gap-2 border-t border-border pt-3">
                <h3 className="font-display text-body font-bold">{t('console.cc.testTitle')}</h3>
                <p className="text-small text-text-muted">{t('console.cc.testBody')}</p>
                {sites.data.sites.length > 0 ? (
                  <TestSosForm action={runTestSos} sites={sites.data.sites} label={t('console.cc.testRun')} siteLabel={t('console.cc.testSite')} saving={t('console.cc.saving')} />
                ) : (
                  <p className="text-small text-warning-text">{t('console.cc.noSites')}</p>
                )}
              </div>
            ) : null}
          </Card>
        )}
      </div>

      <div className="grid items-start gap-4 xl:grid-cols-2">
        {incidents.length > 0 ? <IncidentList title={t('console.cc.open')} incidents={incidents} selectedId={selectedId} t={t} live /> : null}
        <FleetCard crews={crews} t={t} />
        {canAct && incidents.length > 0 && sites.data.sites.length > 0 ? (
          <Card className="flex flex-col gap-2 rounded-card p-5">
            <h2 className="font-display text-title font-bold">{t('console.cc.testTitle')}</h2>
            <p className="text-small text-text-muted">{t('console.cc.testBody')}</p>
            <TestSosForm action={runTestSos} sites={sites.data.sites} label={t('console.cc.testRun')} siteLabel={t('console.cc.testSite')} saving={t('console.cc.saving')} />
          </Card>
        ) : null}
        <IncidentList title={t('console.cc.recent')} incidents={recent.data.incidents} selectedId={selectedId} t={t} empty={t('console.cc.recentEmpty')} />
      </div>
    </>
  );
}

type T = ReturnType<typeof createI18n>['t'];

function IncidentList({ title, incidents, selectedId, t, live, empty }: { title: string; incidents: DeskIncident[]; selectedId: string | null; t: T; live?: boolean; empty?: string }) {
  return (
    <Card className="flex min-w-0 flex-col gap-2 rounded-card p-5">
      <h2 className="font-display text-title font-bold">{title}</h2>
      {incidents.length === 0 ? (
        <p className="text-small text-text-muted">{empty}</p>
      ) : (
        <ul className="flex flex-col divide-y divide-border">
          {incidents.map((i) => (
            <li key={i.id}>
              <Link
                href={`/?incident=${i.id}`}
                aria-current={i.id === selectedId ? 'true' : undefined}
                className={cn('flex min-h-tap flex-wrap items-center gap-x-3 gap-y-1 rounded-control px-2 py-2 hover:bg-surface-raised', i.id === selectedId && 'bg-surface-raised')}
              >
                <span className="font-mono font-semibold">{i.ref}</span>
                {i.isDrill ? <span className="rounded-pill bg-info-soft px-2 py-0.5 text-caption font-bold text-info-text">{t('console.cc.drill')}</span> : null}
                <span className="min-w-0 flex-1 truncate text-small">
                  {i.isDrill ? t('console.cc.drillResident') : (i.resident.name ?? t('console.cc.noName'))} · {homeLine(i.resident, t)}
                </span>
                <span className={cn('rounded-pill px-2 py-0.5 text-caption font-bold', statePill(i.state))}>{t(`console.cc.state.${i.state}`)}</span>
                {live ? (
                  <span className="text-caption text-text-muted">
                    <Since iso={i.createdAt} template="{{time}}" />
                  </span>
                ) : null}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function FleetCard({ crews, t }: { crews: FleetCrew[]; t: T }) {
  const order = (c: FleetCrew) => (c.incidentId ? 0 : c.onDuty ? 1 : 2);
  return (
    <Card className="flex min-w-0 flex-col gap-2 rounded-card p-5" data-testid="fleet">
      <h2 className="font-display text-title font-bold">{t('console.cc.fleet')}</h2>
      {crews.length === 0 ? (
        <p className="text-small text-text-muted">{t('console.cc.fleetEmpty')}</p>
      ) : (
        <ul className="flex flex-col divide-y divide-border">
          {[...crews]
            .sort((a, b) => order(a) - order(b))
            .map((c) => (
              <li key={c.crewId} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2 text-small">
                <span aria-hidden className={cn('size-2 shrink-0 rounded-pill', c.incidentId ? 'bg-danger' : c.onDuty ? 'bg-map-ambulance' : 'bg-map-ambulance-off')} />
                <span className="font-mono">{c.registration ?? t('console.cc.noVehicle')}</span>
                <span className="min-w-0 flex-1 truncate">
                  {[c.name ?? t('console.cc.unnamedCrew'), c.team, c.drillParticipant ? t('console.cc.drillCrew') : null].filter(Boolean).join(' · ')}
                </span>
                {c.incidentId ? (
                  <Link href={`/?incident=${c.incidentId}`} className="font-semibold text-danger-text underline-offset-4 hover:underline">
                    {t('console.cc.fleetStatus.busy', { ref: sosRef(c.incidentId) })}
                  </Link>
                ) : (
                  <span className="text-text-muted">{c.onDuty ? t('console.cc.fleetStatus.free') : t('console.cc.fleetStatus.off')}</span>
                )}
              </li>
            ))}
        </ul>
      )}
    </Card>
  );
}
