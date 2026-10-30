import Link from 'next/link';
import { createI18n } from '@repo/i18n';
import { Button, Card } from '@repo/ui-web';
import { serverApi } from '@/lib/api';

// Residents directory. What each role sees is decided by the API: the
// community desk gets its own community only, never medical data.
export default async function ResidentsPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const { q } = await searchParams;
  const { t } = createI18n('en');
  const api = await serverApi();
  const { data, response } = await api.GET('/v1/residents', { params: { query: { q: q?.trim() || undefined } } });

  return (
    <>
      <h1 className="font-display text-h1 font-bold">{t('console.residents.title')}</h1>
      <form role="search" className="flex max-w-xl flex-wrap gap-2">
        <label htmlFor="q" className="sr-only">
          {t('console.residents.search')}
        </label>
        <input
          id="q"
          name="q"
          defaultValue={q}
          placeholder={t('console.residents.search')}
          className="min-h-tap flex-1 rounded-control border border-border-strong bg-surface px-4 text-text"
        />
        <Button type="submit" variant="outline">
          {t('console.residents.searchButton')}
        </Button>
      </form>

      {!data ? (
        <Card role="alert" className="text-danger-text">
          {response.status === 403 ? t('console.notStaff') : t('console.genericError')}
        </Card>
      ) : data.residents.length === 0 ? (
        <Card className="text-text-muted">{t('console.residents.empty')}</Card>
      ) : (
        <div className="overflow-x-auto rounded-panel border border-border bg-surface">
          <table className="w-full min-w-150 text-left text-small">
            <thead className="border-b border-border text-text-muted">
              <tr>
                <th scope="col" className="px-4 py-3 font-semibold">
                  {t('console.residents.title')}
                </th>
                <th scope="col" className="px-4 py-3 font-semibold">
                  {t('console.residents.home')}
                </th>
                <th scope="col" className="px-4 py-3 font-semibold">
                  {t('console.residents.coveredBy')}
                </th>
                <th scope="col" className="px-4 py-3 font-semibold">
                  {t('auth.phoneLabel')}
                </th>
              </tr>
            </thead>
            <tbody>
              {data.residents.map((r) => (
                <tr key={r.userId} className="border-b border-border last:border-0">
                  <td className="px-4 py-3">
                    <Link href={`/residents/${r.userId}`} className="font-semibold text-accent-text underline-offset-4 hover:underline">
                      {r.fullName ?? t('console.residents.noName')}
                    </Link>
                    <div className="text-caption text-text-muted">{r.role === 'owner' ? t('console.residents.owner') : t('console.residents.member')}</div>
                  </td>
                  <td className="px-4 py-3">
                    {r.community ? [r.community, [r.tower, r.number].filter(Boolean).join('-')].join(' · ') : t('console.residents.standalone')}
                    {r.city ? <div className="text-caption text-text-muted">{r.city}</div> : null}
                  </td>
                  <td className="px-4 py-3">{r.coverageTeam ?? <span className="text-text-muted">{t('console.coverage.noTeam')}</span>}</td>
                  <td className="px-4 py-3 font-mono">{r.phone ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="text-caption text-text-muted">{t('console.residents.phoneNote')}</p>
    </>
  );
}
