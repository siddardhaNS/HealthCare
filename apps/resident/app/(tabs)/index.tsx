import { useState } from 'react';
import { Linking, Pressable, View } from 'react-native';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Button, Card, Icon, ServiceTile, Text, useTheme } from '@repo/ui-native';
import { useHealthSummary, useMarkDose, useMyId, useProfile } from '../../lib/data';
import { doseTime, initials, todayIST, vitalValue } from '../../lib/format';
import { ErrorState, Page, SectionLabel, StatusChip } from '../../lib/ui';

function greetingKey(hour: number) {
  if (hour < 12) return 'home.greeting.morning';
  if (hour < 17) return 'home.greeting.afternoon';
  return 'home.greeting.evening';
}

const snapshot = ['bp', 'pulse', 'spo2', 'sugar'] as const;
const services = ['consult', 'pharmacy', 'lab', 'companion'] as const;

// Design: Resident app › Home. Live data from the health record.
export default function Home() {
  const { t, i18n } = useTranslation();
  const { colors, space, radius, tapTarget, fonts } = useTheme();
  const me = useMyId();
  const profile = useProfile();
  const summary = useHealthSummary(me);
  const markDose = useMarkDose(me);
  const [sosNote, setSosNote] = useState(false);

  const latest = summary.data?.latest;
  const meds = (summary.data?.medications ?? []).filter((m) => m.schedule.length > 0);

  return (
    <Page refreshing={summary.isRefetching} onRefresh={() => void summary.refetch()}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space[3] }} accessibilityRole="header">
        <View style={{ width: 44, height: 44, borderRadius: radius.sm, backgroundColor: colors.accentSoft, alignItems: 'center', justifyContent: 'center' }}>
          <Text weight="bold" tone="accent">
            {initials(profile.data?.fullName)}
          </Text>
        </View>
        <View>
          <Text variant="small" tone="muted">
            {t(greetingKey(new Date().getHours()))}
          </Text>
          <Text variant="title">{profile.data?.fullName ?? ''}</Text>
        </View>
      </View>

      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${t('home.snapshot')}. ${t('home.viewTrends')}`}
        onPress={() => router.push('/health')}
        style={({ pressed }) => ({ backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, borderRadius: radius.card, padding: space[4], gap: space[3], opacity: pressed ? 0.9 : 1 })}
      >
        <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
          <Text variant="small" weight="bold">
            {t('home.snapshot')}
          </Text>
          <Text variant="small" weight="bold" tone="accent">
            {t('home.viewTrends')}
          </Text>
        </View>
        {summary.isError ? (
          <ErrorState onRetry={() => void summary.refetch()} />
        ) : latest && snapshot.some((k) => latest[k]) ? (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', rowGap: space[3] }}>
            {snapshot.map((k) => {
              const r = latest[k];
              return (
                <View key={k} style={{ width: '50%', gap: space[1] }}>
                  <Text variant="caption" tone="muted">
                    {t(`health.vitals.${k}`)}
                  </Text>
                  <Text variant="title" style={{ fontFamily: fonts.mono.native.semibold }}>
                    {r ? `${vitalValue(k, r.value, r.value2)} ` : '—'}
                    {r ? (
                      <Text variant="caption" tone="muted">
                        {r.unit}
                      </Text>
                    ) : null}
                  </Text>
                  {r ? <StatusChip level={r.status.level} label={t(`health.status.${r.status.key}`)} /> : null}
                </View>
              );
            })}
          </View>
        ) : (
          <Text variant="small" tone="muted">
            {t('home.snapshotEmpty')}
          </Text>
        )}
      </Pressable>

      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${t('home.sosTitle')}. ${t('home.sosSubtitle')}`}
        onPress={() => setSosNote((v) => !v)}
        style={({ pressed }) => ({
          flexDirection: 'row',
          alignItems: 'center',
          gap: space[3] + 2,
          padding: space[4],
          minHeight: tapTarget,
          borderRadius: radius.card + 2,
          backgroundColor: colors.dangerSoft,
          borderColor: colors.dangerBorder,
          borderWidth: 1,
          opacity: pressed ? 0.85 : 1,
        })}
      >
        <View style={{ width: 48, height: 48, borderRadius: radius.pill, backgroundColor: colors.danger, alignItems: 'center', justifyContent: 'center' }}>
          <Icon name="siren" color={colors.onDanger} size={24} strokeWidth={2.2} />
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
      {sosNote ? (
        <Card style={{ gap: space[3] }} accessibilityLiveRegion="polite">
          <Text>{t('home.sosSoon')}</Text>
          <Button label="108" tone="danger" onPress={() => void Linking.openURL('tel:108')} />
        </Card>
      ) : null}

      <SectionLabel>{t('home.careServices')}</SectionLabel>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space[3] }}>
        {services.map((s) => (
          <ServiceTile key={s} service={s} title={t(`home.services.${s}.title`)} subtitle={t(`home.services.${s}.subtitle`)} style={{ flexBasis: '47%', flexGrow: 1 }} />
        ))}
      </View>

      <SectionLabel>{t('home.medsToday')}</SectionLabel>
      {meds.length === 0 ? (
        <Card>
          <Text tone="muted">{t('home.noMeds')}</Text>
        </Card>
      ) : (
        meds.flatMap((m) =>
          m.today.map((d) => (
            <Card key={`${m.id}-${d.time}`} style={{ flexDirection: 'row', alignItems: 'center', gap: space[3] }}>
              <View style={{ width: 44, height: 44, borderRadius: radius.sm, backgroundColor: colors.servicePharmacySoft, alignItems: 'center', justifyContent: 'center' }}>
                <Icon name="pill" color={colors.servicePharmacy} />
              </View>
              <View style={{ flex: 1 }}>
                <Text weight="bold">{[m.name, m.strength].filter(Boolean).join(' ')}</Text>
                <Text variant="small" tone="muted">
                  {doseTime(d.time, i18n.language)}
                </Text>
              </View>
              {d.status === 'taken' ? (
                <StatusChip level="ok" label={t('home.taken')} />
              ) : (
                <Button
                  label={t('home.markTaken')}
                  tone="neutral"
                  disabled={markDose.isPending}
                  onPress={() => markDose.mutate({ medicationId: m.id, date: todayIST(), time: d.time, status: 'taken' })}
                />
              )}
            </Card>
          )),
        )
      )}
    </Page>
  );
}
