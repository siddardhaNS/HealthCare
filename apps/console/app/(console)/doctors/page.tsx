import Link from 'next/link';
import { createI18n } from '@repo/i18n';
import { Button, Card } from '@repo/ui-web';
import { serverApi } from '@/lib/api';
import { ActionForm } from '../_coverage/action-form';
import { addDoctor } from '../_consults/actions';
import { DoctorFields, DoctorStatus } from './doctor-fields';

const field = 'min-h-tap rounded-control border border-border-strong bg-surface px-3 text-text';

// Doctors (Phase 4 ⚑1): super admin and operations (the API checks).
export default async function DoctorsPage() {
  const { t } = createI18n('en');
  const api = await serverApi();
  const [doctors, specialties] = await Promise.all([api.GET('/v1/console/doctors'), api.GET('/v1/console/specialties')]);
  const name = (id: string) => specialties.data?.specialties.find((s) => s.id === id)?.names.en ?? '';

  return (
    <>
      <div className="flex max-w-3xl flex-col gap-2">
        <h1 className="font-display text-h1 font-bold">{t('console.doctors.title')}</h1>
        <p className="text-text-muted">{t('console.doctors.intro')}</p>
      </div>
      {!doctors.data || !specialties.data ? (
        <Card role="alert" className="text-danger-text">
          {doctors.response.status === 403 ? t('console.notStaff') : t('console.genericError')}
        </Card>
      ) : (
        <>
          <Card className="flex flex-col gap-3 rounded-panel p-5">
            <h2 className="font-display text-title font-bold">{t('console.doctors.add')}</h2>
            <ActionForm action={addDoctor} reset label={t('console.doctors.add')} doneText={t('console.doctors.saved')} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <label className="flex flex-col gap-1 text-small font-semibold">
                {t('console.doctors.email')}
                <input name="email" type="email" required className={field} />
              </label>
              <DoctorFields t={t} specialties={specialties.data.specialties.filter((s) => s.active)} />
              <div className="sm:col-span-2 lg:col-span-3">
                <Button type="submit">{t('console.doctors.save')}</Button>
              </div>
            </ActionForm>
          </Card>

          {doctors.data.doctors.length === 0 ? (
            <Card className="text-text-muted">{t('console.doctors.empty')}</Card>
          ) : (
            <ul className="flex flex-col gap-3" data-testid="doctors">
              {doctors.data.doctors.map((d) => (
                <li key={d.id}>
                  <Card className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-card p-4">
                    <div className="flex min-w-56 flex-1 flex-col">
                      <span className="font-semibold">{d.fullName}</span>
                      <span className="text-small text-text-muted">{[d.qualification, d.specialtyIds.map(name).join(', '), d.email].filter(Boolean).join(' · ')}</span>
                    </div>
                    <DoctorStatus t={t} d={d} />
                    <Link href={`/doctors/${d.id}`} className="inline-flex min-h-tap items-center text-small font-semibold text-accent-text underline-offset-4 hover:underline" aria-label={`${t('console.doctors.open')} ${d.fullName}`}>
                      {t('console.doctors.open')}
                    </Link>
                  </Card>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </>
  );
}
