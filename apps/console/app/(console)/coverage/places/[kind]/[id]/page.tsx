import Link from 'next/link';
import { notFound } from 'next/navigation';
import { MAX_BACKUP_TEAMS } from '@repo/contracts';
import { createI18n } from '@repo/i18n';
import { Button, Card, cn } from '@repo/ui-web';
import { serverApi } from '@/lib/api';
import { ActionForm } from '../../../../_coverage/action-form';
import { setBackups } from '../../../../_coverage/actions';

const field = 'min-h-tap rounded-control border border-border-strong bg-surface px-3 text-text';

/** The list with item i moved by `by` places (up: -1, down: +1). */
const moved = (list: string[], i: number, by: number) => {
  const next = [...list];
  [next[i], next[i + by]] = [next[i + by]!, next[i]!];
  return next;
};

// One place's ordered backup teams (plan §11): reorder, remove, add.
export default async function PlaceBackupsPage({ params }: { params: Promise<{ kind: string; id: string }> }) {
  const { kind, id } = await params;
  if (kind !== 'site' && kind !== 'household') notFound();
  const { t } = createI18n('en');
  const api = await serverApi();
  const [places, teams] = await Promise.all([api.GET('/v1/coverage/places'), api.GET('/v1/coverage/teams')]);
  const back = (
    <Link href="/coverage/places" className="text-small font-semibold text-accent-text underline-offset-4 hover:underline">
      ← {t('console.coverage.placesTitle')}
    </Link>
  );

  if (!places.data || !teams.data) {
    return (
      <>
        {back}
        <Card role="alert" className="text-danger-text">
          {places.response.status === 403 ? t('console.notStaff') : t('console.genericError')}
        </Card>
      </>
    );
  }
  const place = places.data.places.find((p) => p.kind === kind && p.id === id);
  if (!place) {
    return (
      <>
        {back}
        <Card role="alert">{t('console.coverage.placeNotFound')}</Card>
      </>
    );
  }

  const name = place.name || t('console.coverage.unnamedHome');
  const list = place.backups.map((b) => b.teamId);
  const save = (teamIds: string[]) => setBackups.bind(null, kind, id, teamIds);
  const addable = teams.data.teams.filter((x) => x.active && x.id !== place.teamId && !list.includes(x.id));

  return (
    <>
      {back}
      <div className="flex max-w-3xl flex-col gap-2">
        <h1 className="font-display text-h1 font-bold">{t('console.coverage.backupsTitle', { place: name })}</h1>
        <p className="text-text-muted">{t('console.coverage.backupsIntro')}</p>
      </div>

      <Card className="flex max-w-3xl flex-col gap-4 rounded-panel p-5">
        <div>
          <h2 className="text-small font-semibold text-text-muted">{t('console.coverage.primaryTeam')}</h2>
          <p className={cn('font-display text-h3 font-bold', !place.teamName && 'text-warning-text')}>{place.teamName ?? t('console.coverage.noTeam')}</p>
        </div>

        {!place.teamId ? (
          <p role="status" className="text-small text-warning-text">
            {t('console.coverage.needPrimary')}
          </p>
        ) : (
          <>
            {list.length === 0 ? <p className="text-small text-text-muted">{t('console.coverage.noBackups')}</p> : null}
            <ol className="flex flex-col divide-y divide-border" aria-label={t('console.coverage.backupsTitle', { place: name })}>
              {place.backups.map((b, i) => (
                <li key={b.teamId} className="flex flex-wrap items-center gap-2 py-2 text-small">
                  <span className="w-24 text-text-muted">{t('console.coverage.backupN', { n: i + 1 })}</span>
                  <span className="flex-1 font-semibold">
                    {b.teamName}
                    {!b.active ? <span className="ml-2 rounded-pill bg-warning-soft px-2.5 py-1 text-caption font-bold text-warning-text">{t('console.coverage.inactive')}</span> : null}
                  </span>
                  <ActionForm action={save(moved(list, i, -1))}>
                    <Button type="submit" variant="ghost" disabled={i === 0} className="min-h-tap px-2 text-small" aria-label={t('console.coverage.moveUpA11y', { team: b.teamName })}>
                      {t('console.coverage.moveUp')}
                    </Button>
                  </ActionForm>
                  <ActionForm action={save(moved(list, i, 1))}>
                    <Button type="submit" variant="ghost" disabled={i === list.length - 1} className="min-h-tap px-2 text-small" aria-label={t('console.coverage.moveDownA11y', { team: b.teamName })}>
                      {t('console.coverage.moveDown')}
                    </Button>
                  </ActionForm>
                  <ActionForm action={save(list.filter((x) => x !== b.teamId))}>
                    <Button type="submit" variant="ghost" className="min-h-tap px-2 text-small" aria-label={t('console.coverage.removeBackupA11y', { team: b.teamName })}>
                      {t('console.coverage.remove')}
                    </Button>
                  </ActionForm>
                </li>
              ))}
            </ol>

            {list.length >= MAX_BACKUP_TEAMS ? (
              <p className="text-small text-text-muted">{t('console.coverage.maxBackups', { max: MAX_BACKUP_TEAMS })}</p>
            ) : addable.length > 0 ? (
              <ActionForm action={save(list)} reset doneText={t('console.coverage.saved')} label={t('console.coverage.addBackupTeam')} className="flex flex-wrap items-end gap-2">
                <label className="flex min-w-56 flex-1 flex-col gap-1 text-small font-semibold">
                  {t('console.coverage.addBackupTeam')}
                  <select name="teamId" required defaultValue="" className={field}>
                    <option value="" disabled>
                      {t('console.coverage.chooseTeam')}
                    </option>
                    {addable.map((x) => (
                      <option key={x.id} value={x.id}>
                        {x.name}
                      </option>
                    ))}
                  </select>
                </label>
                <Button type="submit" variant="outline">
                  {t('console.coverage.add')}
                </Button>
              </ActionForm>
            ) : null}
          </>
        )}
      </Card>
    </>
  );
}
