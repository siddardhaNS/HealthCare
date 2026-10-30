import Link from 'next/link';
import { createI18n } from '@repo/i18n';
import { Button, Card } from '@repo/ui-web';
import { serverApi } from '@/lib/api';
import { PlacesForm } from './places-form';

// Assign communities, buildings and stand-alone homes to coverage teams
// (plan §9). "Only places without a team" shows the gaps.
export default async function CoveragePlacesPage({ searchParams }: { searchParams: Promise<{ q?: string; uncovered?: string }> }) {
  const { q, uncovered } = await searchParams;
  const { t } = createI18n('en');
  const api = await serverApi();
  const [places, teams] = await Promise.all([
    api.GET('/v1/coverage/places', { params: { query: { q: q?.trim() || undefined, uncovered: uncovered === 'true' ? 'true' : undefined } } }),
    api.GET('/v1/coverage/teams'),
  ]);

  return (
    <>
      <Link href="/coverage" className="text-small font-semibold text-accent-text underline-offset-4 hover:underline">
        ← {t('console.coverage.back')}
      </Link>
      <h1 className="font-display text-h1 font-bold">{t('console.coverage.placesTitle')}</h1>
      <form role="search" className="flex max-w-3xl flex-wrap items-center gap-3">
        <label htmlFor="q" className="sr-only">
          {t('console.coverage.search')}
        </label>
        <input id="q" name="q" defaultValue={q} placeholder={t('console.coverage.search')} className="min-h-tap min-w-64 flex-1 rounded-control border border-border-strong bg-surface px-4 text-text" />
        <label className="flex min-h-tap items-center gap-2 text-small font-semibold">
          <input type="checkbox" name="uncovered" value="true" defaultChecked={uncovered === 'true'} className="size-5" />
          {t('console.coverage.onlyUncovered')}
        </label>
        <Button type="submit" variant="outline">
          {t('console.coverage.searchButton')}
        </Button>
      </form>

      {!places.data || !teams.data ? (
        <Card role="alert" className="text-danger-text">
          {places.response.status === 403 ? t('console.notStaff') : t('console.genericError')}
        </Card>
      ) : places.data.places.length === 0 ? (
        <Card className="text-text-muted">{t('console.coverage.noPlaces')}</Card>
      ) : (
        <PlacesForm
          places={places.data.places}
          teams={teams.data.teams}
          labels={{
            selectAll: t('console.coverage.selectAll'),
            select: t('console.coverage.select'),
            kind: { site: t('console.coverage.kind.site'), household: t('console.coverage.kind.household') },
            households: t('console.coverage.households', { count: '{{count}}' }),
            noTeam: t('console.coverage.noTeam'),
            assignTo: t('console.coverage.assignTo'),
            chooseTeam: t('console.coverage.chooseTeam'),
            unassign: t('console.coverage.unassign'),
            assign: t('console.coverage.assign'),
            assigned: t('console.coverage.assigned', { count: '{{count}}' }),
            unnamedHome: t('console.coverage.unnamedHome'),
            community: t('console.thresholds.community'),
            coveredBy: t('console.residents.coveredBy'),
          }}
        />
      )}
    </>
  );
}
