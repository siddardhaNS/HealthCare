import { brand } from '@repo/brand';
import { createI18n } from '@repo/i18n';
import { Button, Card } from '@repo/ui-web';

const services = [
  { key: 'consult', dot: 'bg-service-consult', soft: 'bg-service-consult-soft' },
  { key: 'pharmacy', dot: 'bg-service-pharmacy', soft: 'bg-service-pharmacy-soft' },
  { key: 'lab', dot: 'bg-service-lab', soft: 'bg-service-lab-soft' },
  { key: 'companion', dot: 'bg-service-companion', soft: 'bg-service-companion-soft' },
] as const;

// Phase 1 shell. Full landing sections (who it's for, SOS story, why us, how it
// works, plans, FAQ, two-step sign-up) land in Phase 6.
export default function LandingPage() {
  const { t } = createI18n('en');
  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-16 px-4 py-6 sm:px-8">
      <header className="flex items-center justify-between">
        <span className="font-display text-title font-bold">{brand.name}</span>
        <Button variant="outline">{t('web.signIn')}</Button>
      </header>

      <section className="flex max-w-3xl flex-col gap-6 pt-10">
        <h1 className="font-display text-display font-bold tracking-tight sm:text-hero">{t('web.heroTitle')}</h1>
        <p className="text-body-lg text-text-muted">{t('web.heroBody')}</p>
        <div>
          <Button size="lg">{t('web.cta')}</Button>
        </div>
      </section>

      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        {services.map((s) => (
          <Card key={s.key} className="flex flex-col gap-3">
            <span className={`flex size-10 items-center justify-center rounded-sm ${s.soft}`}>
              <span className={`size-3 rounded-pill ${s.dot}`} />
            </span>
            <span className="font-semibold">{t(`home.services.${s.key}.title`)}</span>
            <span className="text-small text-text-muted">{t(`home.services.${s.key}.subtitle`)}</span>
          </Card>
        ))}
        <Card className="flex flex-col gap-3 border-danger-border bg-danger-soft">
          <span className="flex size-10 items-center justify-center rounded-sm bg-danger">
            <span className="size-3 rounded-pill bg-on-danger" />
          </span>
          <span className="font-semibold text-danger-text">{t('home.sosTitle')}</span>
          <span className="text-small text-danger-text">{t('home.sosSubtitle')}</span>
        </Card>
      </section>
    </div>
  );
}
