import { createI18n } from '@repo/i18n';
import { Button, Card } from '@repo/ui-web';
import { serverApi } from '@/lib/api';
import { getStaffClaims } from '@/lib/supabase/server';
import { ActionForm } from '../_coverage/action-form';
import { saveDeskPhone } from '../_coverage/actions';

const field = 'min-h-tap w-64 rounded-control border border-border-strong bg-surface px-3 text-text tabular-nums';

// Platform settings (plan §11). Operations can see them; only a super admin changes them (the API checks).
export default async function SettingsPage() {
  const { t } = createI18n('en');
  const [claims, api] = await Promise.all([getStaffClaims(), serverApi()]);
  const canEdit = !!claims?.roles.includes('super_admin');
  const { data } = await api.GET('/v1/config');
  const deskPhone = data?.deskPhone ?? null;

  return (
    <>
      <h1 className="font-display text-h1 font-bold">{t('console.settings.title')}</h1>
      <Card className="flex max-w-3xl flex-col gap-3 rounded-panel p-5">
        <h2 className="font-display text-title font-bold">{t('console.settings.deskPhone')}</h2>
        <p className="text-small text-text-muted">{t('console.settings.deskPhoneHint')}</p>
        {!data ? (
          <p role="alert" className="text-danger-text">
            {t('console.genericError')}
          </p>
        ) : !deskPhone ? (
          <p role="status" className="text-small font-semibold text-warning-text">
            {t('console.settings.deskPhoneUnset')}
          </p>
        ) : null}
        {canEdit ? (
          <ActionForm action={saveDeskPhone} doneText={t('console.settings.saved')} label={t('console.settings.deskPhone')} className="flex flex-wrap items-end gap-3">
            <label className="flex flex-col gap-1 text-small font-semibold">
              {t('console.settings.deskPhoneLabel')}
              <input name="deskPhone" type="tel" inputMode="tel" placeholder="+91XXXXXXXXXX" defaultValue={deskPhone ?? ''} pattern="\+91\d{10}" className={field} />
            </label>
            <Button type="submit" variant="outline">
              {t('console.settings.save')}
            </Button>
          </ActionForm>
        ) : (
          <>
            {deskPhone ? <p className="font-mono text-title">{deskPhone}</p> : null}
            <p className="text-small text-text-muted">{t('console.settings.readOnly')}</p>
          </>
        )}
      </Card>
    </>
  );
}
