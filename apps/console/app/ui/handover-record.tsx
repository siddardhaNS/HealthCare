import type { HandoverRecord } from '@repo/contracts';
import type { createI18n } from '@repo/i18n';
import type { ReactNode } from 'react';

type TFunction = ReturnType<typeof createI18n>['t'];

const when = new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Kolkata' });

function Section({ title, children, testId }: { title: string; children: ReactNode; testId?: string }) {
  return (
    <section className="flex flex-col gap-1 border-t border-border pt-3" data-testid={testId}>
      <h3 className="text-caption font-bold uppercase text-text-muted">{title}</h3>
      {children}
    </section>
  );
}

const List = ({ items, empty }: { items: ReactNode[]; empty: string }) =>
  items.length === 0 ? (
    <p className="text-small text-text-muted">{empty}</p>
  ) : (
    <ul className="flex list-disc flex-col gap-1 pl-5">
      {items.map((x, n) => (
        <li key={n}>{x}</li>
      ))}
    </ul>
  );

/**
 * The ER's emergency record: only the items the patient consented to are
 * present in the record (the API leaves the rest out), so a missing section
 * means "not shared", never "none".
 */
export function HandoverRecordView({ r, t }: { r: HandoverRecord; t: TFunction }) {
  const none = t('console.partner.none');
  const limited = r.items.length === 1 && r.items[0] === 'blood_group';
  return (
    <div className="flex flex-col gap-3" data-testid="handover-record">
      <div className="flex flex-wrap items-end gap-x-6 gap-y-2">
        <div className="flex flex-col">
          <span className="text-caption font-bold uppercase text-text-muted">{t('console.partner.patient')}</span>
          <span className="font-display text-h3 font-bold">{r.patient.name ?? t('console.partner.unknown')}</span>
          {r.patient.age !== null || r.patient.sex ? (
            <span className="text-small text-text-muted">
              {[r.patient.age !== null ? t('console.partner.age', { age: r.patient.age }) : null, r.patient.sex].filter(Boolean).join(' · ')}
            </span>
          ) : null}
        </div>
        <div className="flex flex-col">
          <span className="text-caption font-bold uppercase text-text-muted">{t('console.partner.bloodGroup')}</span>
          <span className="font-mono text-h2 font-bold text-danger-text" data-testid="blood-group">
            {r.bloodGroup ?? t('console.partner.unknown')}
          </span>
        </div>
      </div>
      {limited ? <p className="rounded-control bg-warning-soft p-3 text-small text-warning-text">{t('console.partner.consentLimited')}</p> : null}

      {r.allergies ? (
        <Section title={t('console.partner.allergies')} testId="allergies">
          <List
            empty={none}
            items={r.allergies.map((a) => (
              <>
                <span className="font-semibold">{a.substance}</span> · {a.severity}
                {a.reaction ? ` · ${a.reaction}` : ''}
              </>
            ))}
          />
        </Section>
      ) : null}
      {r.conditions ? (
        <Section title={t('console.partner.conditions')}>
          <List empty={none} items={r.conditions.map((c) => `${c.name} · ${c.status}`)} />
        </Section>
      ) : null}
      {r.medicines ? (
        <Section title={t('console.partner.medicines')}>
          <List empty={none} items={r.medicines.map((m) => [m.name, m.strength, m.dose, m.frequency].filter(Boolean).join(' · '))} />
        </Section>
      ) : null}
      {r.lastVitals ? (
        <Section title={t('console.partner.lastVitals')}>
          <List
            empty={none}
            items={r.lastVitals.map((v) => `${v.type}: ${v.value}${v.value2 !== null ? `/${v.value2}` : ''} ${v.unit} · ${when.format(new Date(v.takenAt))}`)}
          />
        </Section>
      ) : null}
      {r.emergencyContacts ? (
        <Section title={t('console.partner.emergencyContacts')}>
          <List
            empty={none}
            items={r.emergencyContacts.map((c) => (
              <>
                {[c.name, c.relation].filter(Boolean).join(' · ')} ·{' '}
                <a className="font-semibold text-accent-text underline" href={`tel:${c.phone}`}>
                  {c.phone}
                </a>
              </>
            ))}
          />
        </Section>
      ) : null}
      {r.insurance ? (
        <Section title={t('console.partner.insurance')}>
          <List
            empty={none}
            items={r.insurance.map((i) =>
              [
                i.insurer,
                i.policyNumber ? t('console.partner.policy', { n: i.policyNumber }) : null,
                i.memberId ? t('console.partner.member', { n: i.memberId }) : null,
                i.validUntil ? t('console.partner.validUntil', { date: i.validUntil }) : null,
              ]
                .filter(Boolean)
                .join(' · '),
            )}
          />
        </Section>
      ) : null}
      <Section title={t('console.partner.firstAid')}>
        <p className="whitespace-pre-wrap text-small">{r.firstAidNotes ?? none}</p>
      </Section>
    </div>
  );
}
