import { createI18n } from '@repo/i18n';
import { Card } from '@repo/ui-web';

// Command center lands in Phase 3 (SOS); this is the signed-in shell.
export default function CommandCenter() {
  const { t } = createI18n('en');
  return (
    <>
      <h1 className="font-display text-h1 font-bold">{t('console.commandCenter')}</h1>
      <Card className="max-w-md rounded-panel">
        <p className="text-text-muted">{t('common.comingSoon')}</p>
      </Card>
    </>
  );
}
