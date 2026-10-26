import { brand } from '@repo/brand';
import { createI18n } from '@repo/i18n';
import { Button, Card } from '@repo/ui-web';

// Phase 1 shell for the admin console and partner portal (role-based, same app).
// Staff auth (email + TOTP) and the command center arrive in later phases.
export default function ConsoleHome() {
  const { t } = createI18n('en');
  return (
    <div className="flex min-h-dvh flex-col md:flex-row">
      <aside className="flex flex-col gap-2 border-b border-border bg-surface-raised p-5 md:w-64 md:border-r md:border-b-0">
        <span className="font-display text-title font-bold">{brand.shortName}</span>
        <nav aria-label="Console" className="mt-4 flex flex-col gap-1">
          <span className="rounded-control bg-accent-soft px-3 py-2 font-semibold text-accent-text">{t('console.commandCenter')}</span>
        </nav>
      </aside>
      <main className="flex flex-1 flex-col gap-6 p-6 md:p-10">
        <h1 className="font-display text-h1 font-bold">{t('console.commandCenter')}</h1>
        <Card className="flex max-w-md flex-col gap-4 rounded-panel">
          <p className="text-text-muted">{t('console.signInPrompt')}</p>
          <div>
            <Button>{t('web.signIn')}</Button>
          </div>
        </Card>
      </main>
    </div>
  );
}
