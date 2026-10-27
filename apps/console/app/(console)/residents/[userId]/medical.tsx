import type { HealthSummary } from '@repo/api-client';
import { vitalTypes } from '@repo/contracts/vitals';
import { createI18n } from '@repo/i18n';
import { Card, cn } from '@repo/ui-web';

// Status colours carry the same meaning in every theme (tokens): ok / warn / danger.
const levelChip = { ok: 'bg-success-soft text-success-text', warn: 'bg-warning-soft text-warning-text', danger: 'bg-danger-soft text-danger-text' } as const;
const severityChip = { mild: 'bg-surface-raised text-text-muted', moderate: 'bg-warning-soft text-warning-text', severe: 'bg-danger-soft text-danger-text' } as const;

const fmt = (type: string, v: number, v2: number | null) => (type === 'bp' ? `${v}/${v2}` : type === 'temp' || type === 'weight' ? v.toFixed(1) : String(v));
const when = (iso: string) => new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata' }).format(new Date(iso));

/** Care-team medical view. Rendered only after the API allowed it (consent checked, disclosure recorded). */
export function MedicalSection({ data }: { data: HealthSummary }) {
  const { t } = createI18n('en');
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap gap-x-6 gap-y-1 text-small text-text-muted">
        <span>
          {t('health.bloodGroup')}: <strong className="text-text">{data.profile.bloodGroup ?? '—'}</strong>
        </span>
        <span>
          {t('health.age')}: <strong className="text-text">{data.age ?? '—'}</strong>
        </span>
        <span>
          {t('health.bmi')}: <strong className="text-text">{data.bmi ?? '—'}</strong>
        </span>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {vitalTypes.map((type) => {
          const r = data.latest[type];
          return (
            <Card key={type} className="flex flex-col gap-1.5 rounded-panel p-4">
              <span className="text-small font-semibold text-text-muted">{t(`health.vitals.${type}`)}</span>
              {r ? (
                <>
                  <span className="font-mono text-h2 font-semibold">
                    {fmt(type, r.value, r.value2)} <span className="text-small text-text-muted">{r.unit}</span>
                  </span>
                  <span className={cn('self-start rounded-pill px-2.5 py-0.5 text-caption font-bold', levelChip[r.status.level])}>{t(`health.status.${r.status.key}`)}</span>
                  <span className="text-caption text-text-muted">
                    {t('health.takenAt', { when: when(r.takenAt) })}
                    {r.enteredByOther ? ` · ${t('health.byOther')}` : ''}
                  </span>
                </>
              ) : (
                <span className="text-small text-text-muted">{t('health.noReading')}</span>
              )}
            </Card>
          );
        })}
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="flex flex-col gap-2 rounded-panel">
          <h3 className="font-display text-title font-bold">{t('health.conditions')}</h3>
          {data.conditions.length === 0 ? <p className="text-small text-text-muted">{t('health.none')}</p> : null}
          <ul className="flex flex-col gap-2">
            {data.conditions.map((c) => (
              <li key={c.id} className="flex flex-col gap-0.5">
                <span className="flex flex-wrap items-center gap-2 font-semibold">
                  {c.name}
                  <span className="rounded-pill bg-surface-raised px-2 py-0.5 text-caption text-text-muted">{t(`health.conditionStatus.${c.status}`)}</span>
                </span>
                {c.notes ? <span className="text-small text-text-muted">{c.notes}</span> : null}
              </li>
            ))}
          </ul>
        </Card>

        <Card className="flex flex-col gap-2 rounded-panel">
          <h3 className="font-display text-title font-bold">{t('health.allergies')}</h3>
          {data.allergies.length === 0 ? <p className="text-small text-text-muted">{t('health.none')}</p> : null}
          <ul className="flex flex-col gap-2">
            {data.allergies.map((a) => (
              <li key={a.id} className="flex flex-wrap items-center gap-2">
                <span className="font-semibold">{a.substance}</span>
                <span className={cn('rounded-pill px-2 py-0.5 text-caption font-bold', severityChip[a.severity])}>{t(`health.severity.${a.severity}`)}</span>
                {a.reaction ? <span className="text-small text-text-muted">{a.reaction}</span> : null}
              </li>
            ))}
          </ul>
        </Card>

        <Card className="flex flex-col gap-2 rounded-panel">
          <h3 className="font-display text-title font-bold">{t('health.medicines')}</h3>
          {data.medications.length === 0 ? <p className="text-small text-text-muted">{t('health.none')}</p> : null}
          <ul className="flex flex-col gap-2">
            {data.medications.map((m) => (
              <li key={m.id} className="flex flex-col gap-0.5">
                <span className="font-semibold">{[m.name, m.strength].filter(Boolean).join(' ')}</span>
                <span className="text-small text-text-muted">
                  {m.schedule.join(', ')}
                  {m.schedule.length ? ' · ' : ''}
                  {m.adherence30 === null ? t('health.noAdherence') : t('health.adherence', { pct: m.adherence30 })}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </div>
  );
}
