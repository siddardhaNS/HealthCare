import Link from 'next/link';
import { createI18n } from '@repo/i18n';
import { Button, Card } from '@repo/ui-web';
import { serverApi } from '@/lib/api';
import { ActionForm } from '../../_coverage/action-form';
import { setDoctorActive, updateDoctor, verifyDoctor } from '../../_consults/actions';
import { DoctorFields, DoctorStatus } from '../doctor-fields';

const day = new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' });

// One doctor (⚑1): details, the registration check, and whether residents can book them.
export default async function DoctorPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { t } = createI18n('en');
  const api = await serverApi();
  const [doctors, specialties] = await Promise.all([api.GET('/v1/console/doctors'), api.GET('/v1/console/specialties')]);
  const d = doctors.data?.doctors.find((x) => x.id === id);
  const back = (
    <Link href="/doctors" className="text-small font-semibold text-accent-text underline-offset-4 hover:underline">
      ← {t('console.doctors.back')}
    </Link>
  );
  if (!doctors.data || !specialties.data) {
    return (
      <>
        {back}
        <Card role="alert" className="text-danger-text">
          {doctors.response.status === 403 ? t('console.notStaff') : t('console.genericError')}
        </Card>
      </>
    );
  }
  if (!d) {
    return (
      <>
        {back}
        <Card role="alert">{t('console.doctors.notFound')}</Card>
      </>
    );
  }

  return (
    <>
      {back}
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="font-display text-h1 font-bold">{d.fullName}</h1>
        <DoctorStatus t={t} d={d} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="flex flex-col gap-3 rounded-panel p-5">
          <h2 className="font-display text-title font-bold">{t('console.doctors.verifyTitle')}</h2>
          {d.verifiedAt ? (
            <p className="text-small text-success-text">{t('console.doctors.verifiedOn', { date: day.format(new Date(d.verifiedAt)) })}</p>
          ) : (
            <>
              <p className="text-small">{t('console.doctors.verifyHint', { reg: d.registrationNo, council: d.council })}</p>
              <ActionForm action={verifyDoctor.bind(null, d.id)} doneText={t('console.doctors.saved')}>
                <Button type="submit" variant="outline">
                  {t('console.doctors.verifyButton')}
                </Button>
              </ActionForm>
            </>
          )}
        </Card>
        <Card className="flex flex-col gap-3 rounded-panel p-5">
          <h2 className="font-display text-title font-bold">{t('console.doctors.bookableTitle')}</h2>
          <ActionForm action={setDoctorActive.bind(null, d.id, !d.active)} doneText={t('console.doctors.saved')}>
            <Button type="submit" variant={d.active ? 'outline' : 'accent'}>
              {d.active ? t('console.doctors.stopBookable') : t('console.doctors.makeBookable')}
            </Button>
          </ActionForm>
        </Card>
      </div>

      <Card className="flex flex-col gap-3 rounded-panel p-5">
        <p className="text-small text-text-muted">{t('console.doctors.reverifyHint')}</p>
        <ActionForm action={updateDoctor.bind(null, d.id)} label={d.fullName} doneText={t('console.doctors.saved')} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <DoctorFields t={t} specialties={specialties.data.specialties.filter((s) => s.active || d.specialtyIds.includes(s.id))} d={d} />
          <div className="sm:col-span-2 lg:col-span-3">
            <Button type="submit">{t('console.doctors.save')}</Button>
          </div>
        </ActionForm>
      </Card>
    </>
  );
}
