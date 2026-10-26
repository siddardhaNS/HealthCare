import { useState } from 'react';
import { Switch, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Card, Screen, Text, useTheme } from '@repo/ui-native';

// Phase 1 shell of the field app. Role comes from the staff JWT claims and
// availability is persisted through the API in Phase 3 (crew_shifts).
export default function FieldHome() {
  const { t } = useTranslation();
  const { colors, space } = useTheme();
  const [onDuty, setOnDuty] = useState(false);

  return (
    <Screen>
      <SafeAreaView style={{ flex: 1, paddingHorizontal: space[5], paddingTop: space[6], gap: space[4] }} edges={['top']}>
        <View accessibilityRole="header">
          <Text variant="small" tone="muted">
            {t('field.roles.crew')}
          </Text>
          <Text variant="h3">{t('field.title')}</Text>
        </View>

        <Card style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <Text variant="bodyLg" weight="bold" tone={onDuty ? 'accent' : 'muted'}>
            {onDuty ? t('field.onDuty') : t('field.offDuty')}
          </Text>
          <Switch
            accessibilityLabel={t('field.onDuty')}
            value={onDuty}
            onValueChange={setOnDuty}
            trackColor={{ false: colors.borderStrong, true: colors.accent }}
            thumbColor={colors.text}
          />
        </Card>

        <Card>
          <Text tone="muted">{t('field.noJobs')}</Text>
        </Card>
      </SafeAreaView>
    </Screen>
  );
}
