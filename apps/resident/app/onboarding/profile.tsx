import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { languages, type Language } from '@repo/i18n';
import { Button, Text, TextField } from '@repo/ui-native';
import { offeredLanguage, useAppConfig } from '../../lib/app-config';
import { useSaveProfile } from '../../lib/data';
import { Page, Segmented } from '../../lib/ui';

export default function ProfileStep() {
  const { t, i18n } = useTranslation();
  const save = useSaveProfile();
  const [name, setName] = useState('');
  const config = useAppConfig();
  // Only the languages the super admin has switched on; with English alone there is nothing to choose.
  const offered = languages.filter((l) => (config.languages as string[]).includes(l.code));
  const [chosen, setLanguage] = useState<Language>(offeredLanguage(config, i18n.language));
  const language = offeredLanguage(config, chosen);

  return (
    <Page>
      <Text variant="h2" accessibilityRole="header">
        {t('onboarding.profileTitle')}
      </Text>
      <TextField label={t('onboarding.nameLabel')} value={name} onChangeText={setName} autoComplete="name" textContentType="name" maxLength={80} testID="name-input" />
      {offered.length > 1 ? (
        <>
          <Text variant="small" weight="semibold" tone="muted">
            {t('onboarding.languageLabel')}
          </Text>
          <Segmented
            label={t('onboarding.languageLabel')}
            options={offered.map((l) => ({ value: l.code, label: l.label }))}
            value={language}
            onChange={(l) => {
              setLanguage(l);
              void i18n.changeLanguage(l);
            }}
          />
        </>
      ) : null}
      {save.isError ? <Text tone="danger">{t('common.error')}</Text> : null}
      <Button label={t('onboarding.continue')} disabled={!name.trim() || save.isPending} onPress={() => save.mutate({ fullName: name.trim(), language })} testID="profile-continue" />
    </Page>
  );
}
