import { useState } from 'react';
import { View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Button, Card, Text, TextField, useTheme } from '@repo/ui-native';
import { ApiError, useAcceptInvite, useCreateHousehold, useMyInvites } from '../../lib/data';
import { Page, SectionLabel, Segmented } from '../../lib/ui';

// Join a community by code (only for a home nobody has set up yet), set up a
// standalone family home, or accept an invitation from a family member.
export default function HouseholdStep() {
  const { t } = useTranslation();
  const { space } = useTheme();
  const invites = useMyInvites();
  const accept = useAcceptInvite();
  const create = useCreateHousehold();
  const [mode, setMode] = useState<'join' | 'standalone'>('join');
  const [f, setF] = useState({ joinCode: '', tower: '', number: '', city: '', pin: '', name: '' });
  const set = (k: keyof typeof f) => (v: string) => setF((p) => ({ ...p, [k]: v }));

  const submit = () =>
    create.mutate(
      mode === 'join'
        ? { mode: 'join', joinCode: f.joinCode.trim().toUpperCase(), tower: f.tower.trim() || undefined, number: f.number.trim() }
        : { mode: 'standalone', city: f.city.trim(), pin: f.pin.trim() || undefined, name: f.name.trim() || undefined },
    );
  const canSubmit = mode === 'join' ? f.joinCode.trim().length >= 6 && !!f.number.trim() : !!f.city.trim();
  const error = create.error instanceof ApiError ? create.error.message : create.isError ? t('common.error') : null;

  return (
    <Page>
      <Text variant="h2" accessibilityRole="header">
        {t('onboarding.householdTitle')}
      </Text>
      <Text tone="muted">{t('onboarding.householdBody')}</Text>

      {invites.data?.invites.length ? (
        <>
          <SectionLabel>{t('onboarding.invitesTitle')}</SectionLabel>
          {invites.data.invites.map((i) => (
            <Card key={i.id} style={{ gap: space[3] }}>
              <Text>{t('onboarding.inviteFrom', { name: i.invitedBy ?? t('onboarding.someone'), household: i.householdName ?? t('onboarding.theirHousehold') })}</Text>
              <Button label={t('onboarding.accept')} onPress={() => accept.mutate(i.id)} disabled={accept.isPending} />
            </Card>
          ))}
        </>
      ) : null}

      <Segmented
        label={t('onboarding.householdTitle')}
        options={[
          { value: 'join', label: t('onboarding.joinTab') },
          { value: 'standalone', label: t('onboarding.ownTab') },
        ]}
        value={mode}
        onChange={setMode}
      />

      <View style={{ gap: space[3] }}>
        {mode === 'join' ? (
          <>
            <TextField label={t('onboarding.code')} placeholder={t('onboarding.codeHint')} autoCapitalize="characters" value={f.joinCode} onChangeText={set('joinCode')} maxLength={10} testID="join-code" />
            <TextField label={t('onboarding.tower')} value={f.tower} onChangeText={set('tower')} maxLength={20} />
            <TextField label={t('onboarding.number')} value={f.number} onChangeText={set('number')} maxLength={20} testID="home-number" />
          </>
        ) : (
          <>
            <TextField label={t('onboarding.city')} value={f.city} onChangeText={set('city')} autoComplete="postal-address-locality" maxLength={80} />
            <TextField label={t('onboarding.pin')} value={f.pin} onChangeText={(v) => set('pin')(v.replace(/\D/g, ''))} keyboardType="number-pad" maxLength={6} />
            <TextField label={t('onboarding.householdName')} value={f.name} onChangeText={set('name')} maxLength={80} />
          </>
        )}
      </View>
      {error ? (
        <Text tone="danger" accessibilityLiveRegion="polite">
          {error}
        </Text>
      ) : null}
      <Button label={mode === 'join' ? t('onboarding.join') : t('onboarding.create')} disabled={!canSubmit || create.isPending} onPress={submit} testID="household-continue" />
    </Page>
  );
}
