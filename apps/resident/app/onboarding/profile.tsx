import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { languages, type Language } from '@repo/i18n';
import { Button, Text, TextField } from '@repo/ui-native';
import { useSaveProfile } from '../../lib/data';
import { Page, Segmented } from '../../lib/ui';

export default function ProfileStep() {
  const { t, i18n } = useTranslation();
  const save = useSaveProfile();
  const [name, setName] = useState('');
  const [language, setLanguage] = useState<Language>((['en', 'te', 'hi'].includes(i18n.language) ? i18n.language : 'en') as Language);

  return (
    <Page>
      <Text variant="h2" accessibilityRole="header">
        {t('onboarding.profileTitle')}
      </Text>
      <TextField label={t('onboarding.nameLabel')} value={name} onChangeText={setName} autoComplete="name" textContentType="name" maxLength={80} testID="name-input" />
      <Text variant="small" weight="semibold" tone="muted">
        {t('onboarding.languageLabel')}
      </Text>
      <Segmented
        label={t('onboarding.languageLabel')}
        options={languages.map((l) => ({ value: l.code, label: l.label }))}
        value={language}
        onChange={(l) => {
          setLanguage(l);
          void i18n.changeLanguage(l);
        }}
      />
      {save.isError ? <Text tone="danger">{t('common.error')}</Text> : null}
      <Button label={t('onboarding.continue')} disabled={!name.trim() || save.isPending} onPress={() => save.mutate({ fullName: name.trim(), language })} testID="profile-continue" />
    </Page>
  );
}
