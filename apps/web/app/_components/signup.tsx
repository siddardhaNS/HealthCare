'use client';

import { useId, useState, type FormEvent, type ReactNode } from 'react';
import { createApiClient } from '@repo/api-client';
import type { LeadRequest } from '@repo/contracts';
import { leadOnsite, leadOrgTypes, leadPlans, leadRoles, leadSeniorShares, leadServices, leadWalkthroughs } from '@repo/contracts/leads';
import { buttonVariants, cn, Icon, type IconName } from '@repo/ui-web';
import type { Landing, PlanItem } from '../_lib/copy';
import { serviceStyle } from '../_lib/services';

type Copy = Landing['signup'];
type OrgType = (typeof leadOrgTypes)[number];
type Errors = Partial<Record<'orgName' | 'city' | 'pin' | 'contactName' | 'phone' | 'email' | 'services' | 'consent' | 'form', string>>;

/** Version of the consent sentence (signup.consent). Bump when the text changes. */
const CONSENT_VERSION = 'lead-2026-10';
const typeIcon: Record<OrgType, IconName> = { gated: 'villa', apartment: 'tower', township: 'building', senior_home: 'senior', employer: 'briefcase', family: 'family' };
const isCommunity = (t: OrgType) => t === 'gated' || t === 'apartment' || t === 'township';

interface FormState {
  orgType: OrgType;
  orgName: string;
  city: string;
  area: string;
  pin: string;
  size: number;
  towers: string;
  seniorShare: (typeof leadSeniorShares)[number];
  onsite: Set<(typeof leadOnsite)[number]>;
  contactName: string;
  contactRole: (typeof leadRoles)[number];
  phone: string;
  email: string;
  services: Set<(typeof leadServices)[number]>;
  plan: (typeof leadPlans)[number];
  walkthrough: (typeof leadWalkthroughs)[number];
  notes: string;
  consent: boolean;
  website: string;
}

const initial: FormState = {
  orgType: 'gated',
  orgName: '',
  city: '',
  area: '',
  pin: '',
  size: 240,
  towers: '',
  seniorShare: 'unknown',
  onsite: new Set(['guard']),
  contactName: '',
  contactRole: 'association',
  phone: '',
  email: '',
  services: new Set(['consult', 'pharmacy', 'lab', 'sos']),
  plan: 'complete',
  walkthrough: 'this_week',
  notes: '',
  consent: false,
  website: '',
};

const inputCls = (bad?: boolean) =>
  cn('min-h-12 w-full rounded-sm border bg-bg px-3.5 text-body text-text outline-none focus-visible:ring-2 focus-visible:ring-accent', bad ? 'border-danger' : 'border-border-strong');
const chipCls = (on: boolean) => cn('inline-flex min-h-tap cursor-pointer items-center gap-2.5 rounded-sm border px-3.5 text-small font-semibold', on ? 'border-accent bg-accent-soft' : 'border-border-strong bg-bg');

function Field({ label, error, children, id }: { label: string; error?: string; children: ReactNode; id: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <label htmlFor={id} className="text-small font-bold">
        {label}
      </label>
      {children}
      {error ? (
        <span id={`${id}-err`} className="text-small font-semibold text-danger-text">
          {error}
        </span>
      ) : null}
    </div>
  );
}

export function PlansAndSignup(props: {
  plans: { eyebrow: string; title: string; popular: string; choose: string; chosen: string; items: PlanItem[] };
  copy: Copy;
  intro: ReactNode;
  apiUrl: string;
  serviceNames: Record<(typeof leadServices)[number], string>;
}) {
  const { copy: c, plans } = props;
  const uid = useId();
  const id = (k: string) => `${uid}-${k}`;
  const [f, setF] = useState<FormState>(initial);
  const [step, setStep] = useState<1 | 2>(1);
  const [errors, setErrors] = useState<Errors>({});
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<{ ref: string; f: FormState } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => {
    setF((p) => ({ ...p, [k]: v }));
    setErrors((e) => ({ ...e, [k]: undefined, form: undefined }));
  };
  const toggle = <K extends 'onsite' | 'services'>(k: K, v: FormState[K] extends Set<infer T> ? T : never) => {
    setF((p) => {
      const next = new Set(p[k] as Set<typeof v>);
      if (next.has(v)) next.delete(v);
      else next.add(v);
      return { ...p, [k]: next };
    });
    setErrors((e) => ({ ...e, [k]: undefined }));
  };

  function choosePlan(key: PlanItem['key'], name: string) {
    set('plan', key);
    setDone(null);
    setNotice(plans.chosen.replace('{{name}}', name));
    document.getElementById('signup')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function validate1(): Errors {
    const e: Errors = {};
    if (f.orgType !== 'family' && !f.orgName.trim()) e.orgName = c.errors.orgName;
    if (!f.city.trim()) e.city = c.errors.city;
    if (f.pin && !/^\d{6}$/.test(f.pin.trim())) e.pin = c.errors.pin;
    return e;
  }

  function validate2(): Errors {
    const e: Errors = {};
    if (!f.contactName.trim()) e.contactName = c.errors.contactName;
    const digits = f.phone.replace(/\D/g, '').replace(/^91(?=\d{10}$)/, '');
    if (!/^[6-9]\d{9}$/.test(digits)) e.phone = c.errors.phone;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(f.email.trim())) e.email = c.errors.email;
    if (f.services.size === 0) e.services = c.errors.services;
    if (!f.consent) e.consent = c.errors.consent;
    return e;
  }

  async function submit(ev: FormEvent) {
    ev.preventDefault();
    const e = validate2();
    if (Object.keys(e).length) {
      setErrors({ ...e, form: c.errors.fix });
      return;
    }
    const body: LeadRequest = {
      orgType: f.orgType,
      orgName: f.orgType === 'family' ? undefined : f.orgName.trim(),
      city: f.city.trim(),
      area: f.area.trim() || undefined,
      pin: f.pin.trim() || undefined,
      size: f.size,
      towers: isCommunity(f.orgType) && f.towers ? Number(f.towers) : undefined,
      seniorShare: f.seniorShare,
      onsite: isCommunity(f.orgType) ? [...f.onsite] : [],
      contactName: f.contactName.trim(),
      contactRole: f.contactRole,
      phone: `+91${f.phone.replace(/\D/g, '').slice(-10)}`,
      email: f.email.trim(),
      services: [...f.services],
      plan: f.plan,
      walkthrough: f.walkthrough,
      notes: f.notes.trim() || undefined,
      consent: true,
      consentVersion: CONSENT_VERSION,
      website: f.website || undefined,
    };
    setBusy(true);
    try {
      const { data, response } = await createApiClient({ baseUrl: props.apiUrl }).POST('/v1/leads', { body });
      if (data) setDone({ ref: data.ref, f });
      else setErrors({ form: response.status === 429 ? c.errors.rateLimited : c.errors.fix });
    } catch {
      setErrors({ form: c.errors.network });
    } finally {
      setBusy(false);
    }
  }

  const sizeMax = f.orgType === 'family' ? 10 : f.orgType === 'employer' ? 5000 : 2000;
  const sizeMin = f.orgType === 'family' ? 1 : 20;
  const sizeStep = f.orgType === 'family' ? 1 : 10;
  const svcList = leadServices.map((k) => ({ key: k, label: props.serviceNames[k] }));
  const describe = (k: keyof Errors) => (errors[k] ? `${id(k)}-err` : undefined);

  return (
    <>
      <section id="plans" className="scroll-mt-18 border-y border-border bg-surface-raised py-18">
        <div className="mx-auto flex w-full max-w-300 flex-col gap-8 px-6">
          <div className="flex max-w-180 flex-col gap-3">
            <span className="text-small font-bold tracking-widest text-accent-text uppercase">{plans.eyebrow}</span>
            <h2 className="font-display text-h1 font-bold tracking-tight md:text-display">{plans.title}</h2>
          </div>
          <div className="grid grid-cols-[repeat(auto-fit,minmax(270px,1fr))] gap-4">
            {plans.items.map((p) => (
              <article key={p.key} className={cn('flex flex-col gap-3.5 rounded-section border bg-surface p-6.5', p.popular ? 'border-accent ring-1 ring-accent' : 'border-border')}>
                <div className="flex items-center justify-between gap-2">
                  <h3 className="font-display text-title font-bold">{p.name}</h3>
                  {p.popular ? <span className="rounded-pill bg-accent px-2.5 py-1 text-caption font-bold text-on-accent">{plans.popular}</span> : null}
                </div>
                <p className="text-small text-text-muted">{p.for}</p>
                <ul className="flex grow flex-col gap-2.5">
                  {p.items.map((it) => (
                    <li key={it} className="flex items-start gap-2.5 text-small">
                      <Icon name="check" size={18} strokeWidth={2.4} className="shrink-0 text-accent-text" />
                      {it}
                    </li>
                  ))}
                </ul>
                <button type="button" onClick={() => choosePlan(p.key, p.name)} className={buttonVariants({ variant: p.popular ? 'accent' : 'outline', size: 'lg' })}>
                  {plans.choose.replace('{{name}}', p.name)}
                </button>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section id="signup" className="scroll-mt-18 py-22">
        <div className="mx-auto flex w-full max-w-300 flex-wrap items-start gap-12 px-6">
          <div className="flex min-w-0 flex-[1_1_340px] flex-col gap-4.5">{props.intro}</div>
          <div className="min-w-0 flex-[1.3_1_480px]">
            {notice && !done ? (
              <p role="status" className="mb-4 rounded-control border border-accent-border bg-accent-soft px-4 py-3 text-small font-semibold text-accent-text">
                {notice}
              </p>
            ) : null}
            {done ? (
              <div role="status" className="flex flex-col items-start gap-4 rounded-section border border-border-strong bg-surface p-7">
                <span className="flex size-16 items-center justify-center rounded-pill bg-accent-soft text-accent-text">
                  <Icon name="check" size={30} strokeWidth={2.4} />
                </span>
                <h3 className="font-display text-h2 font-bold">{c.done.title.replace('{{name}}', done.f.contactName.trim().split(' ')[0] ?? '')}</h3>
                <p className="text-text-muted">
                  {c.done.body} <span className="font-mono font-semibold text-text">{done.ref}</span>.
                </p>
                <dl className="grid w-full grid-cols-[120px_minmax(0,1fr)] gap-x-3.5 gap-y-2.5 text-small">
                  <dt className="text-text-muted">{c.done.type}</dt>
                  <dd>{c.types[done.f.orgType]}</dd>
                  <dt className="text-text-muted">{c.done.size}</dt>
                  <dd>{done.f.size.toLocaleString('en-IN')}</dd>
                  <dt className="text-text-muted">{c.done.plan}</dt>
                  <dd>{c.plansOptions[done.f.plan]}</dd>
                  <dt className="text-text-muted">{c.done.services}</dt>
                  <dd>{svcList.filter((s) => done.f.services.has(s.key)).map((s) => s.label).join(', ')}</dd>
                  <dt className="text-text-muted">{c.done.walkthrough}</dt>
                  <dd>{c.walkthroughs[done.f.walkthrough]}</dd>
                  <dt className="text-text-muted">{c.done.call}</dt>
                  <dd>+91 {done.f.phone.replace(/\D/g, '').slice(-10)}</dd>
                </dl>
                <button
                  type="button"
                  className={buttonVariants({ variant: 'outline' })}
                  onClick={() => {
                    setDone(null);
                    setStep(1);
                    setF({ ...initial, onsite: new Set(initial.onsite), services: new Set(initial.services) });
                  }}
                >
                  {c.done.another}
                </button>
              </div>
            ) : (
              <form onSubmit={submit} noValidate aria-label={c.formLabel} className="flex flex-col gap-5 rounded-section border border-border-strong bg-surface p-7">
                <div className="flex flex-wrap items-center justify-between gap-2.5">
                  <h3 className="font-display text-h3 font-bold">{step === 1 ? c.step1Title : c.step2Title}</h3>
                  <span className="text-small text-text-muted">{c.step.replace('{{n}}', String(step))}</span>
                </div>
                <div className="h-1.5 overflow-hidden rounded-pill bg-border" aria-hidden="true">
                  <span className={cn('block h-1.5 rounded-pill bg-accent transition-all', step === 1 ? 'w-1/2' : 'w-full')} />
                </div>

                {/* Honeypot: invisible to people and screen readers. */}
                <input type="text" name="website" tabIndex={-1} autoComplete="off" aria-hidden="true" className="hidden" value={f.website} onChange={(e) => set('website', e.target.value)} />

                {step === 1 ? (
                  <>
                    <fieldset className="flex flex-col gap-2.5">
                      <legend className="mb-2.5 text-small font-bold">{c.type}</legend>
                      <div className="grid grid-cols-[repeat(auto-fit,minmax(150px,1fr))] gap-2.5">
                        {leadOrgTypes.map((t) => {
                          const on = f.orgType === t;
                          return (
                            <button
                              key={t}
                              type="button"
                              aria-pressed={on}
                              onClick={() => {
                                set('orgType', t);
                                if (t === 'family') setF((p) => ({ ...p, orgType: t, size: Math.min(p.size, 10), contactRole: 'family' }));
                                else if (f.orgType === 'family') setF((p) => ({ ...p, orgType: t, size: 240, contactRole: t === 'employer' ? 'hr' : 'association' }));
                              }}
                              className={cn('flex flex-col items-start gap-2.5 rounded-control border p-4 text-left font-semibold', on ? 'border-accent bg-accent-soft text-accent-text' : 'border-border-strong bg-bg')}
                            >
                              <Icon name={typeIcon[t]} />
                              {c.types[t]}
                            </button>
                          );
                        })}
                      </div>
                    </fieldset>

                    <div className="grid grid-cols-[repeat(auto-fit,minmax(220px,1fr))] gap-3.5">
                      {f.orgType !== 'family' ? (
                        <Field id={id('orgName')} label={c.orgName[f.orgType]} error={errors.orgName}>
                          <input id={id('orgName')} className={inputCls(!!errors.orgName)} value={f.orgName} placeholder={c.orgNamePlaceholder} aria-invalid={!!errors.orgName} aria-describedby={describe('orgName')} onChange={(e) => set('orgName', e.target.value)} />
                        </Field>
                      ) : null}
                      <Field id={id('city')} label={c.city} error={errors.city}>
                        <input id={id('city')} className={inputCls(!!errors.city)} value={f.city} placeholder={c.cityPlaceholder} autoComplete="address-level2" aria-invalid={!!errors.city} aria-describedby={describe('city')} onChange={(e) => set('city', e.target.value)} />
                      </Field>
                      <Field id={id('area')} label={c.area}>
                        <input id={id('area')} className={inputCls()} value={f.area} placeholder={c.areaPlaceholder} onChange={(e) => set('area', e.target.value)} />
                      </Field>
                      <Field id={id('pin')} label={c.pin} error={errors.pin}>
                        <input id={id('pin')} inputMode="numeric" maxLength={6} autoComplete="postal-code" className={inputCls(!!errors.pin)} value={f.pin} placeholder={c.pinPlaceholder} aria-invalid={!!errors.pin} aria-describedby={describe('pin')} onChange={(e) => set('pin', e.target.value.replace(/\D/g, ''))} />
                      </Field>
                    </div>

                    <div className="flex flex-col gap-1.5">
                      <div className="flex items-baseline justify-between">
                        <label htmlFor={id('size')} className="text-small font-bold">
                          {c.size[f.orgType]}
                        </label>
                        <span className="font-mono text-title font-bold text-accent-text">{f.size.toLocaleString('en-IN')}</span>
                      </div>
                      <input id={id('size')} type="range" min={sizeMin} max={sizeMax} step={sizeStep} value={f.size} onChange={(e) => set('size', Number(e.target.value))} className="h-6 w-full accent-accent" />
                      <div className="flex justify-between text-caption text-text-muted">
                        <span>{sizeMin}</span>
                        <span>{sizeMax.toLocaleString('en-IN')}+</span>
                      </div>
                    </div>

                    {isCommunity(f.orgType) || f.orgType === 'senior_home' ? (
                      <div className="grid grid-cols-[repeat(auto-fit,minmax(220px,1fr))] gap-3.5">
                        {isCommunity(f.orgType) ? (
                          <Field id={id('towers')} label={`${c.towers} (${c.optional})`}>
                            <input id={id('towers')} type="number" min={1} className={inputCls()} value={f.towers} onChange={(e) => set('towers', e.target.value)} />
                          </Field>
                        ) : null}
                        <Field id={id('seniors')} label={c.seniors}>
                          <select id={id('seniors')} className={inputCls()} value={f.seniorShare} onChange={(e) => set('seniorShare', e.target.value as FormState['seniorShare'])}>
                            {leadSeniorShares.map((s) => (
                              <option key={s} value={s}>
                                {c.seniorShares[s]}
                              </option>
                            ))}
                          </select>
                        </Field>
                      </div>
                    ) : null}

                    {isCommunity(f.orgType) ? (
                      <fieldset className="flex flex-col gap-2.5">
                        <legend className="mb-2.5 text-small font-bold">{c.onsite}</legend>
                        <div className="flex flex-wrap gap-2">
                          {leadOnsite.map((o) => (
                            <label key={o} className={chipCls(f.onsite.has(o))}>
                              <input type="checkbox" className="size-4.5 accent-accent" checked={f.onsite.has(o)} onChange={() => toggle('onsite', o)} />
                              {c.onsiteItems[o]}
                            </label>
                          ))}
                        </div>
                      </fieldset>
                    ) : null}

                    <button
                      type="button"
                      className={buttonVariants({ size: 'lg' })}
                      onClick={() => {
                        const e = validate1();
                        if (Object.keys(e).length) return setErrors(e);
                        setErrors({});
                        setStep(2);
                      }}
                    >
                      {c.continue}
                    </button>
                  </>
                ) : (
                  <>
                    <div className="grid grid-cols-[repeat(auto-fit,minmax(220px,1fr))] gap-3.5">
                      <Field id={id('contactName')} label={c.contactName} error={errors.contactName}>
                        <input id={id('contactName')} autoComplete="name" className={inputCls(!!errors.contactName)} value={f.contactName} aria-invalid={!!errors.contactName} aria-describedby={describe('contactName')} onChange={(e) => set('contactName', e.target.value)} />
                      </Field>
                      <Field id={id('role')} label={c.contactRole}>
                        <select id={id('role')} className={inputCls()} value={f.contactRole} onChange={(e) => set('contactRole', e.target.value as FormState['contactRole'])}>
                          {leadRoles.map((r) => (
                            <option key={r} value={r}>
                              {c.roles[r]}
                            </option>
                          ))}
                        </select>
                      </Field>
                      <Field id={id('phone')} label={c.phone} error={errors.phone}>
                        <input id={id('phone')} type="tel" inputMode="numeric" autoComplete="tel" className={inputCls(!!errors.phone)} value={f.phone} placeholder={c.phonePlaceholder} aria-invalid={!!errors.phone} aria-describedby={describe('phone')} onChange={(e) => set('phone', e.target.value)} />
                      </Field>
                      <Field id={id('email')} label={c.email} error={errors.email}>
                        <input id={id('email')} type="email" autoComplete="email" className={inputCls(!!errors.email)} value={f.email} placeholder={c.emailPlaceholder} aria-invalid={!!errors.email} aria-describedby={describe('email')} onChange={(e) => set('email', e.target.value)} />
                      </Field>
                    </div>

                    <fieldset className="flex flex-col gap-2.5" aria-describedby={describe('services')}>
                      <legend className="mb-2.5 text-small font-bold">{c.services}</legend>
                      <div className="grid grid-cols-[repeat(auto-fit,minmax(200px,1fr))] gap-2">
                        {svcList.map((s) => {
                          const st = serviceStyle[s.key];
                          return (
                            <label key={s.key} className={chipCls(f.services.has(s.key))}>
                              <input type="checkbox" className="size-4.5 accent-accent" checked={f.services.has(s.key)} onChange={() => toggle('services', s.key)} />
                              <span className={cn('flex size-6.5 shrink-0 items-center justify-center rounded-xs', st.soft, st.fg)}>
                                <Icon name={st.icon} size={15} />
                              </span>
                              {s.label}
                            </label>
                          );
                        })}
                      </div>
                      {errors.services ? (
                        <span id={`${id('services')}-err`} className="text-small font-semibold text-danger-text">
                          {errors.services}
                        </span>
                      ) : null}
                    </fieldset>

                    <div className="grid grid-cols-[repeat(auto-fit,minmax(220px,1fr))] gap-3.5">
                      <Field id={id('plan')} label={c.plan}>
                        <select id={id('plan')} className={inputCls()} value={f.plan} onChange={(e) => set('plan', e.target.value as FormState['plan'])}>
                          {leadPlans.map((p) => (
                            <option key={p} value={p}>
                              {c.plansOptions[p]}
                            </option>
                          ))}
                        </select>
                      </Field>
                      <Field id={id('when')} label={c.walkthrough}>
                        <select id={id('when')} className={inputCls()} value={f.walkthrough} onChange={(e) => set('walkthrough', e.target.value as FormState['walkthrough'])}>
                          {leadWalkthroughs.map((w) => (
                            <option key={w} value={w}>
                              {c.walkthroughs[w]}
                            </option>
                          ))}
                        </select>
                      </Field>
                    </div>

                    <Field id={id('notes')} label={c.notes}>
                      <textarea id={id('notes')} rows={3} maxLength={1000} className="w-full rounded-sm border border-border-strong bg-bg px-3.5 py-3 text-body text-text" value={f.notes} placeholder={c.notesPlaceholder} onChange={(e) => set('notes', e.target.value)} />
                    </Field>

                    <div className="flex flex-col gap-1.5">
                      <label className="flex cursor-pointer items-start gap-2.5 text-small leading-relaxed">
                        <input type="checkbox" className="mt-0.5 size-4.5 shrink-0 accent-accent" checked={f.consent} aria-invalid={!!errors.consent} aria-describedby={describe('consent')} onChange={(e) => set('consent', e.target.checked)} />
                        {c.consent}
                      </label>
                      {errors.consent ? (
                        <span id={`${id('consent')}-err`} className="text-small font-semibold text-danger-text">
                          {errors.consent}
                        </span>
                      ) : null}
                    </div>

                    {errors.form ? (
                      <p role="alert" className="rounded-control border border-danger-border bg-danger-soft px-4 py-3 text-small font-semibold text-danger-text">
                        {errors.form}
                      </p>
                    ) : null}

                    <div className="flex flex-wrap gap-2.5">
                      <button type="button" className={buttonVariants({ variant: 'outline', size: 'lg' })} onClick={() => setStep(1)}>
                        {c.back}
                      </button>
                      <button type="submit" disabled={busy} className={cn(buttonVariants({ size: 'lg' }), 'grow')}>
                        {busy ? c.submitting : c.submit}
                      </button>
                    </div>
                  </>
                )}
              </form>
            )}
          </div>
        </div>
      </section>
    </>
  );
}
