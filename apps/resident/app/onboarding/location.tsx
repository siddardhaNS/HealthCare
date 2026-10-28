import { View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Button, Card, Icon, Text, useTheme } from '@repo/ui-native';
import { useAnswerLocationStep } from '../../lib/data';
import { Page } from '../../lib/ui';

// Asks for location here, calmly, so an SOS never opens with a permission
// prompt. "Not now" is fine: the system asks again at the first SOS, and the
// alert goes without GPS (dispatch then uses the home's location).
export default function LocationStep() {
  const { t } = useTranslation();
  const { colors, space, radius } = useTheme();
  const answer = useAnswerLocationStep();

  return (
    <Page>
      <View style={{ width: 56, height: 56, borderRadius: radius.pill, backgroundColor: colors.dangerSoft, alignItems: 'center', justifyContent: 'center' }}>
        <Icon name="siren" color={colors.danger} size={28} strokeWidth={2.2} />
      </View>
      <Text variant="h2" accessibilityRole="header">
        {t('onboarding.location.title')}
      </Text>
      <Text tone="muted">{t('onboarding.location.body')}</Text>
      <Card style={{ gap: space[2] }}>
        <Text weight="bold">{t('onboarding.location.whenTitle')}</Text>
        <Text variant="small" tone="muted">
          {t('onboarding.location.when')}
        </Text>
      </Card>
      <Button label={t('onboarding.location.allow')} disabled={answer.isPending} onPress={() => answer.mutate(true)} testID="location-allow" />
      <Button label={t('onboarding.location.notNow')} tone="neutral" disabled={answer.isPending} onPress={() => answer.mutate(false)} testID="location-not-now" />
      <Text variant="small" tone="muted">
        {t('onboarding.location.later')}
      </Text>
    </Page>
  );
}
