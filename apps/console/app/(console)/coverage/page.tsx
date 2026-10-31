import Link from 'next/link';
import type { CoverageTeam } from '@repo/contracts';
import { createI18n } from '@repo/i18n';
import { Button, Card, buttonVariants, cn } from '@repo/ui-web';
import { serverApi } from '@/lib/api';
import { ActionForm } from '../_coverage/action-form';
import { createTeam, setAmbulanceTeam, setCrewTeam, setTeamActive, updateTeam } from '../_coverage/actions';

type T = ReturnType<typeof createI18n>['t'];
type Roster = { crews: { crewId: string; name: string | null; teamId: string | null }[]; ambulances: { id: string; registration: string; teamId: string | null }[] };

const field = 'min-h-tap rounded-control border border-border-strong bg-surface px-3 text-text';

// Coverage teams (plan §9): super admin and operations (the API checks).
export default async function CoveragePage() {
  const { t } = createI18n('en');
  const api = await serverApi();
  const { data, response } = await api.GET('/v1/coverage/teams');

  return (
    <>
      <div className="flex flex-wrap items-start gap-4">
        <div className="flex max-w-3xl flex-1 flex-col gap-2">
          <h1 className="font-display text-h1 font-bold">{t('console.coverage.title')}</h1>
          <p className="text-text-muted">{t('console.coverage.intro')}</p>
        </div>
        <Link href="/coverage/places" className={buttonVariants({ variant: 'accent' })}>
          {t('console.coverage.places')}
        </Link>
      </div>

      {!data ? (
        <Card role="alert" className="text-danger-text">
          {response.status === 403 ? t('console.notStaff') : t('console.genericError')}
        </Card>
      ) : (
        <>
          <Card className="flex flex-col gap-3 rounded-panel p-5">
            <h2 className="font-display text-title font-bold">{t('console.coverage.newTeam')}</h2>
            <ActionForm action={createTeam} reset label={t('console.coverage.newTeam')} className="flex flex-wrap items-end gap-3">
              <label className="flex min-w-56 flex-1 flex-col gap-1 text-small font-semibold">
                {t('console.coverage.name')}
                <input name="name" required maxLength={80} className={field} />
              </label>
              <label className="flex min-w-56 flex-1 flex-col gap-1 text-small font-semibold">
                {t('console.coverage.area')}
                <input name="area" maxLength={80} className={field} />
              </label>
              <Button type="submit">{t('console.coverage.create')}</Button>
            </ActionForm>
          </Card>

          {data.teams.length === 0 ? (
            <Card className="text-text-muted">{t('console.coverage.empty')}</Card>
          ) : (
            <ul className="grid gap-4 xl:grid-cols-2" data-testid="teams">
              {data.teams.map((team) => (
                <li key={team.id}>
                  <TeamCard team={team} teams={data.teams} roster={data.roster} t={t} />
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </>
  );
}

function TeamCard({ team, teams, roster, t }: { team: CoverageTeam; teams: CoverageTeam[]; roster: Roster; t: T }) {
  const teamName = (id: string | null) => teams.find((x) => x.id === id)?.name;
  const onDuty = team.crews.filter((c) => c.onDuty).length;
  const otherCrews = roster.crews.filter((c) => c.teamId !== team.id);
  const otherAmbulances = roster.ambulances.filter((a) => a.teamId !== team.id);
  const elsewhere = (teamId: string | null) => (teamId ? ` (${t('console.coverage.inTeam', { team: teamName(teamId) ?? '' })})` : '');

  return (
    <Card className={cn('flex flex-col gap-4 rounded-card p-5', !team.active && 'border-dashed')} aria-labelledby={`team-${team.id}`}>
      <div className="flex flex-wrap items-center gap-2">
        <h2 id={`team-${team.id}`} className="flex-1 font-display text-h3 font-bold">
          {team.name}
          {team.area ? <span className="text-body font-normal text-text-muted"> · {team.area}</span> : null}
        </h2>
        {!team.active ? <span className="rounded-pill bg-warning-soft px-2.5 py-1 text-caption font-bold text-warning-text">{t('console.coverage.inactive')}</span> : null}
        <span className="rounded-pill bg-surface-raised px-2.5 py-1 text-caption font-bold text-text-muted">{t('console.coverage.onDuty', { count: onDuty })}</span>
      </div>
      <p className="text-small text-text-muted">{t('console.coverage.covers', { sites: team.sites, homes: team.homes, households: team.households })}</p>

      <section className="flex flex-col gap-2">
        <h3 className="font-display text-body font-bold">{t('console.coverage.crews')}</h3>
        {team.crews.length === 0 ? <p className="text-small text-text-muted">{t('console.coverage.noCrews')}</p> : null}
        <ul className="flex flex-col divide-y divide-border">
          {team.crews.map((c) => (
            <li key={c.crewId} className="flex items-center gap-3 py-1.5 text-small">
              <span aria-hidden className={cn('size-2 rounded-pill', c.onDuty ? 'bg-success' : 'bg-map-ambulance-off')} />
              <span className="flex-1">{c.name ?? t('console.coverage.unnamed')}</span>
              <ActionForm action={setCrewTeam.bind(null, null)}>
                <input type="hidden" name="crewId" value={c.crewId} />
                <Button type="submit" variant="ghost" className="min-h-tap px-2 text-small" aria-label={t('console.coverage.removeA11y', { name: c.name ?? t('console.coverage.unnamed'), team: team.name })}>
                  {t('console.coverage.remove')}
                </Button>
              </ActionForm>
            </li>
          ))}
        </ul>
        {otherCrews.length > 0 ? (
          <ActionForm action={setCrewTeam.bind(null, team.id)} reset label={`${t('console.coverage.addCrew')} · ${team.name}`} className="flex flex-wrap items-end gap-2">
            <label className="flex min-w-56 flex-1 flex-col gap-1 text-small font-semibold">
              {t('console.coverage.addCrew')}
              <select name="crewId" required defaultValue="" className={field}>
                <option value="" disabled />
                {otherCrews.map((c) => (
                  <option key={c.crewId} value={c.crewId}>
                    {(c.name ?? t('console.coverage.unnamed')) + elsewhere(c.teamId)}
                  </option>
                ))}
              </select>
            </label>
            <Button type="submit" variant="outline">
              {t('console.coverage.add')}
            </Button>
          </ActionForm>
        ) : null}
      </section>

      <section className="flex flex-col gap-2">
        <h3 className="font-display text-body font-bold">{t('console.coverage.ambulances')}</h3>
        {team.ambulances.length === 0 ? <p className="text-small text-text-muted">{t('console.coverage.noAmbulances')}</p> : null}
        <ul className="flex flex-col divide-y divide-border">
          {team.ambulances.map((a) => (
            <li key={a.id} className="flex items-center gap-3 py-1.5 text-small">
              <span className="flex-1 font-mono">{a.registration}</span>
              <ActionForm action={setAmbulanceTeam.bind(null, null)}>
                <input type="hidden" name="ambulanceId" value={a.id} />
                <Button type="submit" variant="ghost" className="min-h-tap px-2 text-small" aria-label={t('console.coverage.removeA11y', { name: a.registration, team: team.name })}>
                  {t('console.coverage.remove')}
                </Button>
              </ActionForm>
            </li>
          ))}
        </ul>
        {otherAmbulances.length > 0 ? (
          <ActionForm action={setAmbulanceTeam.bind(null, team.id)} reset label={`${t('console.coverage.addAmbulance')} · ${team.name}`} className="flex flex-wrap items-end gap-2">
            <label className="flex min-w-56 flex-1 flex-col gap-1 text-small font-semibold">
              {t('console.coverage.addAmbulance')}
              <select name="ambulanceId" required defaultValue="" className={field}>
                <option value="" disabled />
                {otherAmbulances.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.registration + elsewhere(a.teamId)}
                  </option>
                ))}
              </select>
            </label>
            <Button type="submit" variant="outline">
              {t('console.coverage.add')}
            </Button>
          </ActionForm>
        ) : null}
      </section>

      <details className="rounded-control border border-border p-3">
        <summary className="cursor-pointer text-small font-semibold">{t('console.coverage.edit')}</summary>
        <div className="mt-3 flex flex-col gap-3">
          <ActionForm action={updateTeam.bind(null, team.id)} label={`${t('console.coverage.edit')} · ${team.name}`} className="flex flex-wrap items-end gap-2">
            <label className="flex min-w-48 flex-1 flex-col gap-1 text-small font-semibold">
              {t('console.coverage.name')}
              <input name="name" required maxLength={80} defaultValue={team.name} className={field} />
            </label>
            <label className="flex min-w-48 flex-1 flex-col gap-1 text-small font-semibold">
              {t('console.coverage.area')}
              <input name="area" maxLength={80} defaultValue={team.area ?? ''} className={field} />
            </label>
            <Button type="submit" variant="outline">
              {t('console.coverage.save')}
            </Button>
          </ActionForm>
          <ActionForm action={setTeamActive.bind(null, team.id, !team.active)} className="flex flex-wrap items-center gap-3">
            <Button type="submit" variant={team.active ? 'danger' : 'outline'}>
              {team.active ? t('console.coverage.deactivate') : t('console.coverage.activate')}
            </Button>
            {team.active ? <span className="flex-1 text-small text-text-muted">{t('console.coverage.deactivateHint')}</span> : null}
          </ActionForm>
        </div>
      </details>
    </Card>
  );
}
