import type { Doctor, Specialty } from '@repo/contracts';
import { createI18n, languages } from '@repo/i18n';

type T = ReturnType<typeof createI18n>['t'];
const field = 'min-h-tap rounded-control border border-border-strong bg-surface px-3 text-text';
const rupees = (p: number | null | undefined) => (p == null ? '' : String(p / 100));

/** The doctor's details, shared by "Add a doctor" and the doctor's page (fees in rupees). */
export function DoctorFields({ t, specialties, d }: { t: T; specialties: Specialty[]; d?: Doctor }) {
  const text = (name: keyof Doctor & string, label: string, opts: { required?: boolean; max?: number } = {}) => (
    <label className="flex flex-col gap-1 text-small font-semibold">
      {label}
      <input name={name} required={opts.required} maxLength={opts.max ?? 120} defaultValue={(d?.[name] as string | null | undefined) ?? ''} className={field} />
    </label>
  );
  const money = (name: string, label: string, value: number | null | undefined) => (
    <label className="flex flex-col gap-1 text-small font-semibold">
      {label}
      <input name={name} type="number" min={0} max={100000} step="1" inputMode="numeric" defaultValue={rupees(value)} className={field} />
    </label>
  );
  return (
    <>
      {text('fullName', t('console.doctors.fullName'), { required: true, max: 100 })}
      {text('qualification', t('console.doctors.qualification'), { required: true })}
      {text('registrationNo', t('console.doctors.registrationNo'), { required: true, max: 40 })}
      {text('council', t('console.doctors.council'), { required: true, max: 80 })}
      {money('feeVideo', t('console.doctors.feeVideo'), d?.feeVideoPaise)}
      {money('feeAudio', t('console.doctors.feeAudio'), d?.feeAudioPaise)}
      {money('feeClinic', t('console.doctors.feeClinic'), d?.feeClinicPaise)}
      <label className="flex flex-col gap-1 text-small font-semibold">
        {t('console.doctors.slotMinutes')}
        <select name="slotMinutes" defaultValue={String(d?.slotMinutes ?? 15)} className={field}>
          {[10, 15, 20, 30].map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
      </label>
      {text('clinicAddress', t('console.doctors.clinicAddress'), { max: 300 })}
      <p className="text-caption text-text-muted sm:col-span-2 lg:col-span-3">{t('console.doctors.feeHint')}</p>
      <fieldset className="flex flex-wrap gap-x-4 gap-y-2 sm:col-span-2 lg:col-span-3">
        <legend className="mb-1 text-small font-semibold">{t('console.doctors.languages')}</legend>
        {languages.map((l) => (
          <label key={l.code} className="flex min-h-tap items-center gap-2">
            <input type="checkbox" name="languages" value={l.code} defaultChecked={(d?.languages ?? ['en']).includes(l.code)} className="size-5" />
            <span lang={l.code}>{l.label}</span>
          </label>
        ))}
      </fieldset>
      <fieldset className="flex flex-wrap gap-x-4 gap-y-2 sm:col-span-2 lg:col-span-3">
        <legend className="mb-1 text-small font-semibold">{t('console.doctors.specialties')}</legend>
        {specialties.map((s) => (
          <label key={s.id} className="flex min-h-tap items-center gap-2">
            <input type="checkbox" name="specialtyIds" value={s.id} defaultChecked={d?.specialtyIds.includes(s.id)} className="size-5" />
            {s.names.en}
          </label>
        ))}
      </fieldset>
    </>
  );
}

/** Not verified → verified → bookable, as a pill. */
export function DoctorStatus({ t, d }: { t: T; d: Doctor }) {
  const [label, tone] = d.active
    ? [t('console.doctors.bookable'), 'bg-success-soft text-success-text']
    : d.verifiedAt
      ? [t('console.doctors.verified'), 'bg-surface-raised text-text-muted']
      : [t('console.doctors.unverified'), 'bg-warning-soft text-warning-text'];
  return <span className={`rounded-pill px-2.5 py-1 text-caption font-bold ${tone}`}>{label}</span>;
}
