import { createI18n } from '@repo/i18n';
import { Button, Card } from '@repo/ui-web';
import { serverApi } from '@/lib/api';
import { ActionForm } from '../_coverage/action-form';
import { addException, removeException, saveHours } from '../_consults/actions';

const field = 'min-h-tap rounded-control border border-border-strong bg-surface px-3 text-text tabular-nums';
const dayLabel = new Intl.DateTimeFormat('en-IN', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'Asia/Kolkata' });
const timeLabel = new Intl.DateTimeFormat('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Kolkata' });
const TYPES = ['video', 'audio', 'clinic'] as const;
/** Monday first, as doctors think of the week. */
const WEEK = [1, 2, 3, 4, 5, 6, 0];

// The doctor's own schedule (Phase 4 ⚑3): weekly hours, leave and extra hours, and the slots they make.
export default async function SchedulePage() {
  const { t } = createI18n('en');
  const api = await serverApi();
  const { data, response } = await api.GET('/v1/partner/schedule');

  if (!data) {
    return (
      <>
        <h1 className="font-display text-h1 font-bold">{t('console.schedule.title')}</h1>
        <Card role="alert" className={response.status === 403 ? '' : 'text-danger-text'}>
          {response.status === 403 ? t('console.schedule.notSetUp') : t('console.genericError')}
        </Card>
      </>
    );
  }
  const { doctor: d, hours, exceptions, preview } = data;
  const offered = { video: d.feeVideoPaise != null, audio: d.feeAudioPaise != null, clinic: d.feeClinicPaise != null };
  const byDay = new Map<string, string[]>();
  for (const s of preview) {
    const k = dayLabel.format(new Date(s.startsAt));
    byDay.set(k, [...(byDay.get(k) ?? []), timeLabel.format(new Date(s.startsAt))]);
  }

  return (
    <>
      <div className="flex max-w-3xl flex-col gap-2">
        <h1 className="font-display text-h1 font-bold">{t('console.schedule.title')}</h1>
        <p className="text-text-muted">{t('console.schedule.intro')}</p>
      </div>

      <Card className="flex flex-col gap-3 rounded-panel p-5">
        <h2 className="font-display text-title font-bold">{t('console.schedule.weekly')}</h2>
        <p className="text-small text-text-muted">{t('console.schedule.slotMinutes', { min: d.slotMinutes })}</p>
        <ActionForm action={saveHours} label={t('console.schedule.weekly')} doneText={t('console.schedule.saved')} className="flex flex-col gap-2">
          {WEEK.map((weekday) => {
            const rows = hours.filter((h) => h.weekday === weekday);
            return (
              <fieldset key={weekday} className="flex flex-col gap-2 border-b border-border pb-2 last:border-0">
                <legend className="font-semibold">{t(`console.schedule.weekday.${weekday}`)}</legend>
                {[0, 1].map((i) => {
                  const h = rows[i];
                  const name = `h${weekday}_${i}`;
                  return (
                    <div key={i} className="flex flex-wrap items-end gap-3">
                      <label className="flex flex-col gap-1 text-small">
                        {t('console.schedule.from')}
                        <input type="time" name={`${name}_start`} defaultValue={h?.start ?? ''} className={field} />
                      </label>
                      <label className="flex flex-col gap-1 text-small">
                        {t('console.schedule.to')}
                        <input type="time" name={`${name}_end`} defaultValue={h?.end ?? ''} className={field} />
                      </label>
                      {TYPES.map((type) => (
                        <label key={type} className="flex min-h-tap items-center gap-2 text-small">
                          <input type="checkbox" name={`${name}_types`} value={type} disabled={!offered[type]} defaultChecked={h ? h.types.includes(type) : offered[type] && type !== 'clinic'} className="size-5" />
                          {t(`console.schedule.types.${type}`)}
                        </label>
                      ))}
                    </div>
                  );
                })}
              </fieldset>
            );
          })}
          <Button type="submit" className="self-start">
            {t('console.schedule.saveHours')}
          </Button>
        </ActionForm>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="flex flex-col gap-3 rounded-panel p-5">
          <h2 className="font-display text-title font-bold">{t('console.schedule.exceptions')}</h2>
          {exceptions.length === 0 ? <p className="text-small text-text-muted">{t('console.schedule.none')}</p> : null}
          <ul className="flex flex-col divide-y divide-border">
            {exceptions.map((e) => (
              <li key={e.id} className="flex items-center gap-3 py-1.5 text-small">
                <span className="flex-1">
                  {t(`console.schedule.kind.${e.kind}`)}: {e.from === e.to ? e.from : `${e.from} – ${e.to}`}
                  {e.kind === 'extra' ? ` · ${e.start}–${e.end}` : ''}
                </span>
                <ActionForm action={removeException.bind(null, e.id)}>
                  <Button type="submit" variant="ghost" className="min-h-tap px-2 text-small">
                    {t('console.schedule.remove')}
                  </Button>
                </ActionForm>
              </li>
            ))}
          </ul>
          <ActionForm action={addException} reset label={t('console.schedule.exceptions')} doneText={t('console.schedule.saved')} className="flex flex-wrap items-end gap-3">
            <label className="flex flex-col gap-1 text-small font-semibold">
              {t('console.schedule.exceptions')}
              <select name="kind" defaultValue="off" className={field}>
                <option value="off">{t('console.schedule.kind.off')}</option>
                <option value="extra">{t('console.schedule.kind.extra')}</option>
              </select>
            </label>
            <label className="flex flex-col gap-1 text-small font-semibold">
              {t('console.schedule.fromDate')}
              <input type="date" name="from" required className={field} />
            </label>
            <label className="flex flex-col gap-1 text-small font-semibold">
              {t('console.schedule.toDate')}
              <input type="date" name="to" className={field} />
            </label>
            <label className="flex flex-col gap-1 text-small">
              {t('console.schedule.from')}
              <input type="time" name="start" className={field} />
            </label>
            <label className="flex flex-col gap-1 text-small">
              {t('console.schedule.to')}
              <input type="time" name="end" className={field} />
            </label>
            <Button type="submit" variant="outline">
              {t('console.schedule.addException')}
            </Button>
          </ActionForm>
        </Card>

        <Card className="flex flex-col gap-3 rounded-panel p-5" data-testid="slot-preview">
          <h2 className="font-display text-title font-bold">{t('console.schedule.preview')}</h2>
          {byDay.size === 0 ? <p className="text-small text-text-muted">{t('console.schedule.previewEmpty')}</p> : null}
          <dl className="flex flex-col gap-2 text-small">
            {[...byDay].map(([dayName, times]) => (
              <div key={dayName}>
                <dt className="font-semibold">{dayName}</dt>
                <dd className="font-mono text-text-muted">{times.join('  ')}</dd>
              </div>
            ))}
          </dl>
        </Card>
      </div>
    </>
  );
}
