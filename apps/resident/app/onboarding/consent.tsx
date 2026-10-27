import { useState } from 'react';
import { Switch, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { consentPurposes, purposeMeta, type ConsentPurpose } from '@repo/contracts/consent';
import { Button, Card, Text, useTheme } from '@repo/ui-native';
import { useSetConsent } from '../../lib/data';
import { Page, StatusChip } from '../../lib/ui';

const optional = consentPurposes.filter((p) => purposeMeta[p].onboarding && !purposeMeta[p].required);

// Approved Phase 2 decision ⚑1: nothing is pre-ticked. Keeping the health
// record is required for health features; every other purpose is a separate,
// explicit choice, with emergency sharing first and marked recommended.
export default function ConsentStep() {
  const { t } = useTranslation();
  const { colors, space } = useTheme();
  const setConsent = useSetConsent();
  const [chosen, setChosen] = useState<Partial<Record<ConsentPurpose, boolean>>>({});
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  async function save() {
    setBusy(true);
    setFailed(false);
    try {
      // Optional choices first, so the core consent (which completes
      // onboarding) is recorded last.
      for (const p of optional) if (chosen[p]) await setConsent.mutateAsync({ purpose: p, granted: true });
      await setConsent.mutateAsync({ purpose: 'care_record', granted: true });
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Page>
      <Text variant="h2" accessibilityRole="header">
        {t('consent.screenTitle')}
      </Text>
      <Text tone="muted">{t('consent.screenBody')}</Text>

      <Card style={{ gap: space[2] }}>
        <Text variant="bodyLg" weight="bold">
          {t('consent.care_record.title')}
        </Text>
        <Text variant="small" tone="muted">
          {t('consent.care_record.body')}
        </Text>
        <StatusChip level="neutral" label={t('consent.required')} />
      </Card>

      {optional.map((p) => (
        <Card key={p} style={{ flexDirection: 'row', gap: space[3], alignItems: 'flex-start' }}>
          <View style={{ flex: 1, gap: space[1] + 2 }}>
            <Text variant="body" weight="bold">
              {t(`consent.${p}.title`)}
            </Text>
            <Text variant="small" tone="muted">
              {t(`consent.${p}.body`)}
            </Text>
            {p === 'emergency_share' ? <StatusChip level="ok" label={t('consent.recommended')} /> : null}
          </View>
          <Switch
            accessibilityLabel={t(`consent.${p}.title`)}
            value={!!chosen[p]}
            onValueChange={(v) => setChosen((c) => ({ ...c, [p]: v }))}
            trackColor={{ false: colors.borderStrong, true: colors.accent }}
            thumbColor={colors.text}
            testID={`consent-${p}`}
          />
        </Card>
      ))}

      <Text variant="small" tone="muted">
        {t('onboarding.consentRequired')}
      </Text>
      {failed ? <Text tone="danger">{t('common.error')}</Text> : null}
      <Button label={t('onboarding.consentContinue')} disabled={busy} onPress={save} testID="consent-continue" />
    </Page>
  );
}
