import { useEffect, useState } from 'react';
import { Switch, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { SafeAreaView } from 'react-native-safe-area-context';
import { isFieldRole, type FieldRole } from '@repo/contracts/roles';
import { useSession } from '@repo/mobile';
import { Button, Card, Screen, Text, useTheme } from '@repo/ui-native';

// Phase 1 shell of the field app. Roles come from the API (verified token
// claims); availability is persisted through the API in Phase 3 (crew_shifts).
export default function FieldHome() {
  const { t } = useTranslation();
  const { colors, space } = useTheme();
  const { api, supabase } = useSession();
  const [role, setRole] = useState<FieldRole | null | 'loading' | 'error'>('loading');
  const [onDuty, setOnDuty] = useState(false);

  useEffect(() => {
    void api.GET('/v1/me').then(({ data }) => setRole(data ? (data.roles.find(isFieldRole) ?? null) : 'error'));
  }, [api]);

  const signOut = () => void supabase.auth.signOut();

  if (role === 'loading') return <Screen />;

  if (role === null || role === 'error') {
    return (
      <Screen>
        <SafeAreaView style={{ flex: 1, padding: space[5], paddingTop: space[16], gap: space[5] }}>
          <Text variant="h3">{t('field.title')}</Text>
          <Text tone="muted">{role === null ? t('auth.fieldOnly') : t('auth.genericError')}</Text>
          <Button label={t('auth.signOut')} tone="neutral" onPress={signOut} />
        </SafeAreaView>
      </Screen>
    );
  }

  return (
    <Screen>
      <SafeAreaView style={{ flex: 1, paddingHorizontal: space[5], paddingTop: space[6], gap: space[4] }} edges={['top']}>
        <View accessibilityRole="header">
          <Text variant="small" tone="muted">
            {t(`field.roles.${role}`)}
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

        <Button label={t('auth.signOut')} tone="neutral" onPress={signOut} />
      </SafeAreaView>
    </Screen>
  );
}
