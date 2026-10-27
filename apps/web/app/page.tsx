import type { Metadata } from 'next';
import { brand } from '@repo/brand';
import { buttonVariants, cn, Icon, type IconName } from '@repo/ui-web';
import { HowTabs, ServicesTabs, SosStory } from './_components/interactive';
import { PlansAndSignup } from './_components/signup';
import { tl, tlObj, type Landing, type PlanItem, type ServiceItem, type Step } from './_lib/copy';
import { serviceOrder, serviceStyle } from './_lib/services';

export const metadata: Metadata = {
  title: { absolute: tl('meta.title') },
  description: tl('meta.description'),
  openGraph: { title: tl('meta.title'), description: tl('meta.description'), siteName: brand.name, locale: 'en_IN', type: 'website' },
};

const container = 'mx-auto w-full max-w-300 px-6';
const eyebrow = 'text-small font-bold tracking-widest text-accent-text uppercase';
const h2 = 'font-display text-h1 font-bold tracking-tight text-balance md:text-display';

function Logo() {
  return (
    <span className="flex size-8.5 items-center justify-center rounded-sm bg-accent text-on-accent">
      <Icon name="pulse" size={20} strokeWidth={2.2} />
    </span>
  );
}

function SectionHead({ kicker, title, body }: { kicker: string; title: string; body?: string }) {
  return (
    <div className="flex max-w-180 flex-col gap-3">
      <span className={eyebrow}>{kicker}</span>
      <h2 className={h2}>{title}</h2>
      {body ? <p className="text-body-lg text-text-muted">{body}</p> : null}
    </div>
  );
}

const navKeys = ['services', 'sos', 'why', 'how', 'plans'] as const;
const audienceIcons: IconName[] = ['villa', 'tower', 'senior', 'briefcase', 'family'];
const whyIcons: IconName[] = ['villa', 'clock', 'heart', 'shield', 'handshake', 'lang'];

export default function LandingPage() {
  const services = tlObj<ServiceItem[]>('services.items');
  const plans = tlObj<PlanItem[]>('plans.items');
  const signup = tlObj<Landing['signup']>('signup');
  const faqs = tlObj<{ q: string; a: string }[]>('faq.items');
  const phone = tlObj<Landing['hero']['phone']>('hero.phone');
  const year = new Date().getFullYear();

  return (
    <div className="min-h-dvh bg-bg text-text">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:rounded-sm focus:bg-accent focus:px-4 focus:py-2 focus:text-on-accent">
        {tl('nav.skip')}
      </a>

      <header className="sticky top-0 z-30 border-b border-border bg-bg/90 backdrop-blur-md">
        <div className={cn(container, 'flex flex-wrap items-center gap-x-6 gap-y-3 py-3')}>
          <a href="#top" className="inline-flex items-center gap-2.5 font-display text-h3 font-bold tracking-tight">
            <Logo />
            {brand.name}
          </a>
          <nav aria-label={tl('nav.label')} className="hidden grow flex-wrap gap-1 md:flex">
            {navKeys.map((k) => (
              <a key={k} href={`#${k}`} className="rounded-sm px-3 py-2.5 text-small font-semibold text-text-muted hover:text-text">
                {tl(`nav.${k}`)}
              </a>
            ))}
          </nav>
          <a href="#signup" className={cn(buttonVariants(), 'ml-auto md:ml-0')}>
            {tl('nav.cta')}
          </a>
        </div>
      </header>

      <main id="main">
        {/* Hero */}
        <section id="top" className="scroll-mt-18 py-18">
          <div className={cn(container, 'flex flex-wrap items-center gap-14')}>
            <div className="flex min-w-0 flex-[1_1_460px] flex-col gap-6">
              <span className="inline-flex items-center gap-2 self-start rounded-pill bg-accent-soft px-3.5 py-2 text-small font-bold text-accent-text">
                <span className="size-2 rounded-pill bg-accent" />
                {tl('hero.eyebrow')}
              </span>
              <h1 className="font-display text-display leading-tight font-bold tracking-tight text-balance md:text-hero">{tl('hero.title')}</h1>
              <p className="max-w-140 text-title leading-relaxed font-normal text-text-muted">{tl('hero.lead')}</p>
              <div className="flex flex-wrap gap-3">
                <a href="#signup" className={buttonVariants({ size: 'lg' })}>
                  {tl('hero.primary')}
                </a>
                <a href="#how" className={buttonVariants({ variant: 'outline', size: 'lg' })}>
                  {tl('hero.secondary')}
                </a>
              </div>
              <ul className="flex flex-wrap gap-x-5.5 gap-y-2.5">
                {tlObj<string[]>('hero.points').map((p) => (
                  <li key={p} className="flex items-center gap-2 text-small font-semibold">
                    <Icon name="check" size={16} strokeWidth={2.4} className="text-accent-text" />
                    {p}
                  </li>
                ))}
              </ul>
            </div>

            {/* Illustration of the resident app (decorative; summarised for screen readers). */}
            <div className="flex min-w-0 flex-[1_1_380px] justify-center" role="img" aria-label={phone.alt}>
              <div className="relative w-full max-w-110 px-7.5 py-9" aria-hidden="true">
                <div className="mx-auto flex w-65 flex-col gap-3 rounded-section border border-border-strong bg-surface px-4 py-5.5 shadow-[0_30px_80px_var(--color-shadow)]">
                  <div className="flex items-center gap-2.5">
                    <span className="flex size-8.5 items-center justify-center rounded-sm bg-accent-soft text-caption font-bold text-accent-text">LR</span>
                    <span className="flex flex-col">
                      <span className="text-caption text-text-muted">{phone.greeting}</span>
                      <span className="text-small font-bold">{phone.name}</span>
                    </span>
                  </div>
                  <div className="flex items-center gap-2.5 rounded-md border border-danger-border bg-danger-soft p-2.5">
                    <span className="flex size-9 shrink-0 items-center justify-center rounded-pill bg-danger text-on-danger">
                      <Icon name="siren" size={18} strokeWidth={2.2} />
                    </span>
                    <span className="flex flex-col">
                      <span className="text-small font-bold">{phone.sosTitle}</span>
                      <span className="text-caption text-danger-text">{phone.sosSub}</span>
                    </span>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    {serviceOrder.slice(0, 4).map((k, i) => (
                      <div key={k} className="flex flex-col gap-2 rounded-control border border-border bg-bg p-2.5">
                        <span className={cn('flex size-7 items-center justify-center rounded-xs', serviceStyle[k].soft, serviceStyle[k].fg)}>
                          <Icon name={serviceStyle[k].icon} size={15} />
                        </span>
                        <span className="text-caption font-bold">{phone.tiles[i]}</span>
                      </div>
                    ))}
                  </div>
                  <div className="flex justify-between rounded-control border border-border bg-bg px-3 py-2.5">
                    {phone.vitals.map((v) => (
                      <span key={v.k} className="flex flex-col">
                        <span className="font-mono text-small font-semibold">{v.v}</span>
                        <span className="text-caption text-text-muted">{v.k}</span>
                      </span>
                    ))}
                  </div>
                </div>
                <div className="absolute top-11 right-0 hidden max-w-55 items-center gap-2.5 rounded-control border border-border-strong bg-surface px-3.5 py-2.5 shadow-[0_14px_40px_var(--color-shadow)] sm:flex">
                  <span className="flex size-7.5 shrink-0 items-center justify-center rounded-xs bg-danger-soft text-danger-text">
                    <Icon name="doc" size={16} />
                  </span>
                  <span className="flex flex-col">
                    <span className="text-small font-bold">{phone.cardA.title}</span>
                    <span className="text-caption text-text-muted">{phone.cardA.sub}</span>
                  </span>
                </div>
                <div className="absolute bottom-0 left-0 hidden max-w-55 items-center gap-2.5 rounded-control border border-border-strong bg-surface px-3.5 py-2.5 shadow-[0_14px_40px_var(--color-shadow)] sm:flex">
                  <span className="flex size-7.5 shrink-0 items-center justify-center rounded-xs bg-accent-soft text-accent-text">
                    <Icon name="pill" size={16} />
                  </span>
                  <span className="flex flex-col">
                    <span className="text-small font-bold">{phone.cardB.title}</span>
                    <span className="text-caption text-text-muted">{phone.cardB.sub}</span>
                  </span>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Built for */}
        <section aria-label={tl('audiences.label')} className="border-y border-border bg-surface-raised py-6.5">
          <div className={cn(container, 'flex flex-wrap items-center gap-x-7 gap-y-3.5')}>
            <span className="text-caption font-bold tracking-widest text-text-muted uppercase">{tl('audiences.label')}</span>
            {tlObj<string[]>('audiences.items').map((a, i) => (
              <span key={a} className="inline-flex items-center gap-2 font-semibold">
                <Icon name={audienceIcons[i] ?? 'villa'} className="text-accent-text" />
                {a}
              </span>
            ))}
          </div>
        </section>

        {/* Services */}
        <section id="services" className="scroll-mt-18 py-22">
          <div className={cn(container, 'flex flex-col gap-9')}>
            <SectionHead kicker={tl('services.eyebrow')} title={tl('services.title')} body={tl('services.body')} />
            <ServicesTabs items={services} tabsLabel={tl('services.tabsLabel')} ctaTemplate={tl('services.cta', { name: '{{name}}' })} />
          </div>
        </section>

        {/* SOS */}
        <section id="sos" className="scroll-mt-18 border-y border-danger-border bg-danger-soft py-22">
          <div className={container}>
            <SosStory
              steps={tlObj<{ t: string; sub: string }[]>('sos.steps')}
              labels={{ play: tl('sos.play'), playing: tl('sos.playing'), replay: tl('sos.replay'), now: tl('sos.now'), done: tl('sos.done') }}
            >
              <span className="text-small font-bold tracking-widest text-danger-text uppercase">{tl('sos.eyebrow')}</span>
              <h2 className={h2}>{tl('sos.title')}</h2>
              <p className="text-body-lg text-text-muted">{tl('sos.body')}</p>
            </SosStory>
          </div>
        </section>

        {/* Why us */}
        <section id="why" className="scroll-mt-18 py-22">
          <div className={cn(container, 'flex flex-col gap-9')}>
            <SectionHead kicker={tl('why.eyebrow')} title={tl('why.title')} />
            <div className="grid grid-cols-[repeat(auto-fit,minmax(250px,1fr))] gap-4">
              {tlObj<{ t: string; b: string }[]>('why.items').map((u, i) => {
                const st = serviceStyle[serviceOrder[i % 4]!];
                return (
                  <article key={u.t} className="flex flex-col gap-3 rounded-card border border-border bg-surface p-6">
                    <span className={cn('flex size-11.5 items-center justify-center rounded-control', st.soft, st.fg)}>
                      <Icon name={whyIcons[i] ?? 'heart'} />
                    </span>
                    <h3 className="font-display text-title font-bold">{u.t}</h3>
                    <p className="text-small leading-relaxed text-text-muted">{u.b}</p>
                  </article>
                );
              })}
            </div>
          </div>
        </section>

        {/* How it works */}
        <section id="how" className="scroll-mt-18 border-y border-border bg-surface-raised py-18">
          <div className={cn(container, 'flex flex-col gap-8')}>
            <SectionHead kicker={tl('how.eyebrow')} title={tl('how.title')} />
            <HowTabs groupLabel={tl('how.groupLabel')} tabs={tlObj<Record<string, string>>('how.tabs')} steps={tlObj<Record<string, Step[]>>('how.steps')} />
          </div>
        </section>

        {/* Console preview */}
        <section id="console" className="scroll-mt-18 py-22">
          <div className={cn(container, 'flex flex-wrap items-center gap-12')}>
            <div className="flex min-w-0 flex-[1_1_400px] flex-col gap-4.5">
              <span className={eyebrow}>{tl('console.eyebrow')}</span>
              <h2 className={h2}>{tl('console.title')}</h2>
              <p className="text-body-lg text-text-muted">{tl('console.body')}</p>
              <ul className="flex flex-col gap-3">
                {tlObj<string[]>('console.points').map((p) => (
                  <li key={p} className="flex items-start gap-2.5">
                    <span className="flex size-5.5 shrink-0 items-center justify-center rounded-pill bg-accent-soft text-accent-text">
                      <Icon name="check" size={14} strokeWidth={2.4} />
                    </span>
                    {p}
                  </li>
                ))}
              </ul>
            </div>
            <div className="min-w-0 flex-[1_1_480px]">
              <div className="flex flex-col gap-3.5 rounded-section border border-border-strong bg-surface p-4.5 shadow-[0_30px_80px_var(--color-shadow)]">
                <div className="flex items-center gap-2" aria-hidden="true">
                  <span className="size-2.5 rounded-pill bg-border-strong" />
                  <span className="size-2.5 rounded-pill bg-border-strong" />
                  <span className="size-2.5 rounded-pill bg-border-strong" />
                  <span className="ml-2 text-caption text-text-muted">{tl('console.mockTitle')}</span>
                </div>
                <div className="grid grid-cols-3 gap-2.5">
                  {tlObj<{ k: string; v: string }[]>('console.kpis').map((k) => (
                    <div key={k.k} className="flex flex-col gap-1 rounded-sm border border-border bg-bg px-3 py-2.5">
                      <span className="text-caption text-text-muted">{k.k}</span>
                      <span className="font-mono text-h2 font-semibold">{k.v}</span>
                    </div>
                  ))}
                </div>
                <svg viewBox="0 0 480 170" role="img" aria-label={tl('console.mapAlt')} className="block h-auto w-full rounded-sm">
                  <rect width="480" height="170" className="fill-map-bg" />
                  <path d="M0 60h480M0 130h480M160 0v170M360 0v170" className="stroke-map-road" strokeWidth="10" />
                  <rect x="30" y="72" width="76" height="42" rx="8" className="fill-map-park" />
                  <rect x="320" y="72" width="100" height="42" rx="8" className="fill-map-park" />
                  <path d="M120 20 L120 60 L70 60 L70 92" fill="none" className="stroke-danger" strokeWidth="3" strokeDasharray="6 5" />
                  <circle cx="70" cy="92" r="16" className="fill-danger" opacity="0.2" />
                  <circle cx="70" cy="92" r="7" className="fill-danger" />
                  <rect x="110" y="12" width="20" height="16" rx="4" className="fill-danger" />
                  <rect x="290" y="117" width="20" height="16" rx="4" className="fill-map-ambulance" />
                  <rect x="400" y="52" width="20" height="16" rx="4" className="fill-map-ambulance" />
                  <rect x="440" y="136" width="22" height="22" rx="6" className="fill-map-hospital" />
                </svg>
                <span className="text-caption text-text-muted">{tl('console.note')}</span>
              </div>
            </div>
          </div>
        </section>

        <PlansAndSignup
          apiUrl={process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001'}
          plans={{ eyebrow: tl('plans.eyebrow'), title: tl('plans.title'), popular: tl('plans.popular'), choose: tl('plans.choose', { name: '{{name}}' }), chosen: tl('plans.chosen', { name: '{{name}}' }), items: plans }}
          copy={signup}
          serviceNames={Object.fromEntries(services.map((s) => [s.key, s.name])) as Record<ServiceItem['key'], string>}
          intro={
            <>
              <span className={eyebrow}>{signup.eyebrow}</span>
              <h2 className={h2}>{signup.title}</h2>
              <p className="text-body-lg text-text-muted">{signup.body}</p>
              <ol className="flex flex-col gap-3.5">
                {signup.nextSteps.map((s, i) => (
                  <li key={s.t} className="flex items-start gap-3">
                    <span className="flex size-7.5 shrink-0 items-center justify-center rounded-pill bg-accent-soft font-mono text-small font-bold text-accent-text">{i + 1}</span>
                    <span className="flex flex-col gap-0.5">
                      <span className="font-bold">{s.t}</span>
                      <span className="text-small text-text-muted">{s.b}</span>
                    </span>
                  </li>
                ))}
              </ol>
              <div className="flex flex-col gap-1 rounded-panel border border-border bg-surface px-4.5 py-4">
                <span className="text-small text-text-muted">{signup.talkFirst}</span>
                <span className="font-bold">
                  <a href={`tel:${brand.support.phone}`} className="underline-offset-4 hover:underline">
                    {brand.support.phone}
                  </a>{' '}
                  ·{' '}
                  <a href={`mailto:${brand.support.email}`} className="underline-offset-4 hover:underline">
                    {brand.support.email}
                  </a>
                </span>
              </div>
            </>
          }
        />

        {/* FAQ: native <details> sharing a name, so one answer is open at a time and it works without JS. */}
        <section id="faq" className="scroll-mt-18 border-y border-border bg-surface-raised py-18">
          <div className={cn(container, 'flex max-w-220 flex-col gap-7')}>
            <SectionHead kicker={tl('faq.eyebrow')} title={tl('faq.title')} />
            <div className="flex flex-col gap-2.5">
              {faqs.map((f, i) => (
                <details key={f.q} name="faq" open={i === 0} className="group rounded-panel border border-border bg-surface">
                  <summary className="flex min-h-14 cursor-pointer list-none items-center gap-4 px-5 py-4.5 font-bold [&::-webkit-details-marker]:hidden">
                    <span className="grow">{f.q}</span>
                    <Icon name="plus" className="shrink-0 text-accent-text transition-transform group-open:rotate-45" />
                  </summary>
                  <p className="px-5 pb-5 leading-relaxed text-text-muted">{f.a}</p>
                </details>
              ))}
            </div>
          </div>
        </section>

        {/* CTA band */}
        <section className="py-16">
          <div className={container}>
            <div className="flex flex-wrap items-center justify-between gap-6 rounded-section border border-accent-border bg-accent-soft p-10">
              <div className="flex flex-[1_1_380px] flex-col gap-2.5">
                <h2 className="font-display text-h1 font-bold tracking-tight">{tl('cta.title')}</h2>
                <p className="text-text-muted">{tl('cta.body')}</p>
              </div>
              <a href="#signup" className={buttonVariants({ size: 'lg' })}>
                {tl('cta.button')}
              </a>
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-border bg-surface-raised pt-10 pb-12">
        <div className={cn(container, 'flex flex-wrap items-start justify-between gap-6')}>
          <div className="flex max-w-90 flex-col gap-2">
            <span className="inline-flex items-center gap-2.5 font-display text-h3 font-bold">
              <Logo />
              {brand.name}
            </span>
            <span className="text-small text-text-muted">{tl('footer.about')}</span>
            <span className="text-caption text-text-muted">{tl('footer.copyright', { year, legal: brand.legalEntityName })}</span>
          </div>
          <nav aria-label={tl('footer.label')} className="flex flex-wrap gap-x-5 gap-y-1.5">
            {[...navKeys, 'faq' as const].map((k) => (
              <a key={k} href={`#${k}`} className="py-1.5 text-small text-text-muted hover:text-text">
                {tl(`nav.${k}`)}
              </a>
            ))}
          </nav>
        </div>
      </footer>
    </div>
  );
}
