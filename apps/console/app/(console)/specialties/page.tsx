import type { Specialty } from '@repo/contracts';
import { createI18n } from '@repo/i18n';
import { Button, Card, cn } from '@repo/ui-web';
import { serverApi } from '@/lib/api';
import { ActionForm } from '../_coverage/action-form';
import { addSpecialty, setSpecialtyActive, updateSpecialty } from '../_consults/actions';

type T = ReturnType<typeof createI18n>['t'];
const field = 'min-h-tap rounded-control border border-border-strong bg-surface px-3 text-text';

// Specialties and their symptom words (Phase 4 ⚑4): super admin and operations (the API checks).
export default async function SpecialtiesPage() {
  const { t } = createI18n('en');
  const api = await serverApi();
  const { data, response } = await api.GET('/v1/console/specialties');

  return (
    <>
      <div className="flex max-w-3xl flex-col gap-2">
        <h1 className="font-display text-h1 font-bold">{t('console.specialties.title')}</h1>
        <p className="text-text-muted">{t('console.specialties.intro')}</p>
      </div>
      {!data ? (
        <Card role="alert" className="text-danger-text">
          {response.status === 403 ? t('console.notStaff') : t('console.genericError')}
        </Card>
      ) : (
        <>
          <Card className="flex flex-col gap-3 rounded-panel p-5">
            <h2 className="font-display text-title font-bold">{t('console.specialties.add')}</h2>
            <ActionForm action={addSpecialty} reset label={t('console.specialties.add')} doneText={t('console.specialties.saved')} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <label className="flex flex-col gap-1 text-small font-semibold">
                {t('console.specialties.code')}
                <input name="code" required pattern="[a-z_]{2,40}" className={field} />
              </label>
              <SpecialtyFields t={t} />
              <div className="sm:col-span-2 lg:col-span-3">
                <Button type="submit">{t('console.specialties.save')}</Button>
              </div>
            </ActionForm>
          </Card>
          <ul className="flex flex-col gap-3" data-testid="specialties">
            {data.specialties.map((s) => (
              <li key={s.id}>
                <Card className={cn('flex flex-col gap-3 rounded-card p-4', !s.active && 'border-dashed')}>
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="flex-1 font-display text-title font-bold">
                      {s.names.en} <span className="font-mono text-small font-normal text-text-muted">{s.code}</span>
                    </h2>
                    {!s.active ? <span className="rounded-pill bg-warning-soft px-2.5 py-1 text-caption font-bold text-warning-text">{t('console.specialties.off')}</span> : null}
                    <ActionForm action={setSpecialtyActive.bind(null, s.id, !s.active)}>
                      <Button type="submit" variant="ghost" className="min-h-tap px-2 text-small">
                        {s.active ? t('console.specialties.switchOff') : t('console.specialties.switchOn')}
                      </Button>
                    </ActionForm>
                  </div>
                  <ActionForm action={updateSpecialty.bind(null, s.id)} label={s.names.en} doneText={t('console.specialties.saved')} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                    <SpecialtyFields t={t} s={s} />
                    <div className="sm:col-span-2 lg:col-span-3">
                      <Button type="submit" variant="outline">
                        {t('console.specialties.save')}
                      </Button>
                    </div>
                  </ActionForm>
                </Card>
              </li>
            ))}
          </ul>
        </>
      )}
    </>
  );
}

function SpecialtyFields({ t, s }: { t: T; s?: Specialty }) {
  const langs = [
    ['en', 'nameEn', 'kwEn'],
    ['te', 'nameTe', 'kwTe'],
    ['hi', 'nameHi', 'kwHi'],
  ] as const;
  return (
    <>
      {langs.map(([l, name]) => (
        <label key={`n-${l}`} className="flex flex-col gap-1 text-small font-semibold">
          {t(`console.specialties.${name}`)}
          <input name={`name_${l}`} required maxLength={80} defaultValue={s?.names[l] ?? ''} lang={l} className={field} />
        </label>
      ))}
      {langs.map(([l, , kw]) => (
        <label key={`k-${l}`} className="flex flex-col gap-1 text-small font-semibold">
          {t(`console.specialties.${kw}`)}
          <textarea name={`kw_${l}`} rows={2} defaultValue={(s?.keywords[l] ?? []).join(', ')} lang={l} className={cn(field, 'py-2')} />
        </label>
      ))}
    </>
  );
}
