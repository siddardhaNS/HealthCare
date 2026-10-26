import { Pressable, ScrollView, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useSession } from '@repo/mobile';
import { Button, Card, Screen, ServiceTile, Text, useTheme } from '@repo/ui-native';

function greetingKey(hour: number) {
  if (hour < 12) return 'home.greeting.morning';
  if (hour < 17) return 'home.greeting.afternoon';
  return 'home.greeting.evening';
}

const services = ['consult', 'pharmacy', 'lab', 'companion'] as const;

// Phase 1 shell of the home screen (design: Resident app › Home). The health
// snapshot, upcoming items and dose check-off get real data in Phase 2; SOS is
// wired in Phase 3.
export default function Home() {
  const { t } = useTranslation();
  const theme = useTheme();
  const { supabase } = useSession();
  const { colors, space, radius } = theme;

  return (
    <Screen>
      <SafeAreaView style={{ flex: 1 }} edges={['top']}>
        <ScrollView contentContainerStyle={{ paddingHorizontal: space[5], paddingTop: space[6], paddingBottom: space[4], gap: space[3] + 2 }}>
          <View accessibilityRole="header">
            <Text variant="small" tone="muted">
              {t(greetingKey(new Date().getHours()))}
            </Text>
            <Text variant="title">{t('app.residentName')}</Text>
          </View>

          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`${t('home.sosTitle')}. ${t('home.sosSubtitle')}`}
            style={({ pressed }) => ({
              flexDirection: 'row',
              alignItems: 'center',
              gap: space[3] + 2,
              paddingVertical: space[3] + 2,
              paddingHorizontal: space[4],
              minHeight: theme.tapTarget,
              borderRadius: radius.card + 2,
              backgroundColor: colors.dangerSoft,
              borderColor: colors.dangerBorder,
              borderWidth: 1,
              opacity: pressed ? 0.85 : 1,
            })}
          >
            <View style={{ width: 48, height: 48, borderRadius: radius.pill, backgroundColor: colors.danger, alignItems: 'center', justifyContent: 'center' }}>
              <Text variant="small" weight="bold" tone="onDanger">
                {t('home.sosBadge')}
              </Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text variant="bodyLg" weight="bold" tone="danger">
                {t('home.sosTitle')}
              </Text>
              <Text variant="small" tone="danger">
                {t('home.sosSubtitle')}
              </Text>
            </View>
          </Pressable>

          <Text variant="label" tone="muted" style={{ marginTop: space[2] }}>
            {t('home.careServices')}
          </Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space[3] }}>
            {services.map((s) => (
              <ServiceTile key={s} service={s} title={t(`home.services.${s}.title`)} subtitle={t(`home.services.${s}.subtitle`)} style={{ flexBasis: '47%', flexGrow: 1 }} />
            ))}
          </View>

          <Text variant="label" tone="muted" style={{ marginTop: space[2] }}>
            {t('home.comingUp')}
          </Text>
          <Card>
            <Text tone="muted">{t('common.comingSoon')}</Text>
          </Card>

          {/* Moves to the Profile tab in Phase 2. */}
          <Button label={t('auth.signOut')} tone="neutral" onPress={() => void supabase.auth.signOut()} style={{ marginTop: space[4] }} />
        </ScrollView>
      </SafeAreaView>
    </Screen>
  );
}
