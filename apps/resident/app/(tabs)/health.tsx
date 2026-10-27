import { useState } from 'react';
import { Pressable, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { vitalTypes, type VitalType } from '@repo/contracts/vitals';
import { Button, Card, Icon, Text, TextField, useTheme, type IconName } from '@repo/ui-native';
import { ApiError, useAddAllergy, useAddCondition, useHealthList, useHealthSummary, useLogReading, useMyId, useProfile, useRemove, useVitalSeries } from '../../lib/data';
import { shortDate, vitalValue } from '../../lib/format';
import { TrendChart } from '../../lib/trend-chart';
import { ErrorState, IconButton, Loading, Page, SectionLabel, Segmented, Sheet, StatusChip } from '../../lib/ui';

const vitalIcon: Record<VitalType, IconName> = { bp: 'gauge', pulse: 'pulse', spo2: 'o2', sugar: 'drop', temp: 'thermo', weight: 'scale' };
const severityLevel = { mild: 'neutral', moderate: 'warn', severe: 'danger' } as const;
const conditionLevel = { controlled: 'ok', monitoring: 'warn', active: 'danger', resolved: 'neutral' } as const;

// Design: Resident app › Health.
export default function Health() {
  const { t, i18n } = useTranslation();
  const { colors, space, radius } = useTheme();
  const me = useMyId();
  const profile = useProfile();
  const summary = useHealthSummary(me);
  const [selected, setSelected] = useState<VitalType>('bp');
  const [logOpen, setLogOpen] = useState(false);

  if (summary.isPending) return <Page><Loading /></Page>;
  if (summary.isError) return <Page><ErrorState onRetry={() => void summary.refetch()} /></Page>;
  const s = summary.data;
  const sub = [profile.data?.fullName, s.age, s.profile.bloodGroup].filter((x) => x !== null && x !== undefined && x !== '').join(' · ');

  return (
    <Page refreshing={summary.isRefetching} onRefresh={() => void summary.refetch()}>
      <View style={{ flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', gap: space[3] }}>
        <View style={{ flex: 1 }}>
          {sub ? (
            <Text variant="small" tone="muted">
              {sub}
            </Text>
          ) : null}
          <Text variant="h2" accessibilityRole="header">
            {t('healthTab.title')}
          </Text>
        </View>
        <Button label={t('healthTab.log')} onPress={() => setLogOpen(true)} testID="log-reading" />
      </View>

      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space[3] }}>
        {vitalTypes.map((type) => {
          const r = s.latest[type];
          const on = selected === type;
          return (
            <Pressable
              key={type}
              accessibilityRole="button"
              accessibilityState={{ selected: on }}
              accessibilityLabel={`${t(`health.vitals.${type}`)}${r ? `: ${vitalValue(type, r.value, r.value2)} ${r.unit}, ${t(`health.status.${r.status.key}`)}` : `: ${t('health.noReading')}`}`}
              onPress={() => setSelected(type)}
              style={{ flexBasis: '47%', flexGrow: 1, backgroundColor: colors.surface, borderWidth: 1, borderColor: on ? colors.accentBorder : colors.border, borderRadius: radius.card, padding: space[3] + 2, gap: space[2] }}
            >
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: space[2] }}>
                <Icon name={vitalIcon[type]} size={16} color={colors.textMuted} />
                <Text variant="caption" tone="muted">
                  {t(`health.vitals.${type}`)}
                </Text>
              </View>
              <Text variant="title">
                {r ? vitalValue(type, r.value, r.value2) : '—'}{' '}
                <Text variant="caption" tone="muted">
                  {r?.unit ?? ''}
                </Text>
              </Text>
              {r ? <StatusChip level={r.status.level} label={t(`health.status.${r.status.key}`)} /> : null}
            </Pressable>
          );
        })}
      </View>

      <Trend who={me} type={selected} />

      {s.bmi !== null ? (
        <Card style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
          <Text tone="muted">{t('health.bmi')}</Text>
          <Text weight="bold">{s.bmi}</Text>
        </Card>
      ) : null}

      <Conditions who={me} items={s.conditions} />
      <Allergies who={me} items={s.allergies} />

      <SectionLabel>{t('health.medicines')}</SectionLabel>
      {s.medications.length === 0 ? <Card><Text tone="muted">{t('health.none')}</Text></Card> : null}
      {s.medications.map((m) => (
        <Card key={m.id} style={{ gap: space[2] }}>
          <Text weight="bold">{[m.name, m.strength].filter(Boolean).join(' ')}</Text>
          <Text variant="small" tone="muted">
            {[m.dose, m.frequency, m.schedule.join(', ')].filter(Boolean).join(' · ')}
          </Text>
          {m.adherence30 !== null ? (
            <View style={{ gap: space[1] }}>
              <View style={{ height: 6, borderRadius: radius.pill, backgroundColor: colors.border, overflow: 'hidden' }} accessibilityLabel={t('health.adherence', { pct: m.adherence30 })}>
                <View style={{ width: `${m.adherence30}%`, height: 6, backgroundColor: m.adherence30 >= 80 ? colors.success : m.adherence30 >= 50 ? colors.warning : colors.danger }} />
              </View>
              <Text variant="caption" tone="muted">
                {t('health.adherence', { pct: m.adherence30 })}
              </Text>
            </View>
          ) : null}
        </Card>
      ))}

      <Devices who={me} />
      <Vaccinations who={me} lng={i18n.language} />
      <InsuranceCards who={me} lng={i18n.language} />

      <LogSheet who={me} open={logOpen} initial={selected} onClose={() => setLogOpen(false)} />
    </Page>
  );
}

function Trend({ who, type }: { who: string; type: VitalType }) {
  const { t } = useTranslation();
  const { space } = useTheme();
  const series = useVitalSeries(who, type);
  const readings = [...(series.data?.readings ?? [])].filter((r): r is NonNullable<typeof r> => !!r).reverse();
  const label = t('healthTab.last7', { label: t(`health.vitals.${type}`) });
  return (
    <Card style={{ gap: space[2] }}>
      <Text variant="small" weight="bold">
        {label}
      </Text>
      {readings.length >= 2 ? (
        <TrendChart values={readings.map((r) => r.value)} levels={readings.map((r) => r.status.level)} target={series.data!.target} label={label} />
      ) : (
        <Text variant="small" tone="muted">
          {t('healthTab.trendEmpty')}
        </Text>
      )}
      <Text variant="caption" tone="muted">
        {t('healthTab.target', { range: t(`healthTab.targets.${type}`) })}
      </Text>
    </Card>
  );
}

function LogSheet({ who, open, initial, onClose }: { who: string; open: boolean; initial: VitalType; onClose: () => void }) {
  const { t } = useTranslation();
  const log = useLogReading(who);
  const [type, setType] = useState<VitalType>(initial);
  const [v1, setV1] = useState('');
  const [v2, setV2] = useState('');
  const num = (x: string) => Number(x.replace(',', '.'));
  const ready = v1 !== '' && !Number.isNaN(num(v1)) && (type !== 'bp' || (v2 !== '' && !Number.isNaN(num(v2))));
  const error = log.error instanceof ApiError ? log.error.message : log.isError ? t('common.error') : null;

  return (
    <Sheet visible={open} title={t('healthTab.logTitle')} onClose={onClose}>
      <Segmented label={t('healthTab.logTitle')} options={vitalTypes.map((v) => ({ value: v, label: t(`health.vitals.${v}`) }))} value={type} onChange={(v) => { setType(v); log.reset(); }} />
      <TextField label={type === 'bp' ? t('healthTab.systolic') : `${t('healthTab.value')}`} value={v1} onChangeText={setV1} keyboardType="decimal-pad" testID="reading-value" />
      {type === 'bp' ? <TextField label={t('healthTab.diastolic')} value={v2} onChangeText={setV2} keyboardType="number-pad" testID="reading-value2" /> : null}
      <Text variant="small" tone="muted">
        {t('healthTab.target', { range: t(`healthTab.targets.${type}`) })}
      </Text>
      {error ? (
        <Text tone="danger" accessibilityRole="alert">
          {error}
        </Text>
      ) : null}
      <Button
        label={t('healthTab.save')}
        disabled={!ready || log.isPending}
        onPress={() =>
          log.mutate(
            { type, value: num(v1), value2: type === 'bp' ? num(v2) : undefined },
            {
              onSuccess: () => {
                setV1('');
                setV2('');
                onClose();
              },
            },
          )
        }
        testID="save-reading"
      />
    </Sheet>
  );
}

function Conditions({ who, items }: { who: string; items: { id: string; name: string; status: keyof typeof conditionLevel }[] }) {
  const { t } = useTranslation();
  const { space } = useTheme();
  const add = useAddCondition(who);
  const remove = useRemove(who, 'conditions');
  const [name, setName] = useState('');
  return (
    <>
      <SectionLabel>{t('health.conditions')}</SectionLabel>
      <Card style={{ gap: space[3] }}>
        {items.length === 0 ? <Text tone="muted">{t('health.none')}</Text> : null}
        {items.map((c) => (
          <View key={c.id} style={{ flexDirection: 'row', alignItems: 'center', gap: space[2] }}>
            <View style={{ flex: 1, gap: space[1] }}>
              <Text weight="bold">{c.name}</Text>
              <StatusChip level={conditionLevel[c.status]} label={t(`health.conditionStatus.${c.status}`)} />
            </View>
            <IconButton icon="trash" label={t('healthTab.remove', { name: c.name })} onPress={() => remove.mutate(c.id)} />
          </View>
        ))}
        <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: space[2] }}>
          <View style={{ flex: 1 }}>
            <TextField label={t('healthTab.newCondition')} value={name} onChangeText={setName} maxLength={120} />
          </View>
          <Button label={t('healthTab.add')} tone="neutral" disabled={!name.trim() || add.isPending} onPress={() => add.mutate({ name: name.trim(), status: 'monitoring' }, { onSuccess: () => setName('') })} />
        </View>
      </Card>
    </>
  );
}

function Allergies({ who, items }: { who: string; items: { id: string; substance: string; severity: keyof typeof severityLevel }[] }) {
  const { t } = useTranslation();
  const { space } = useTheme();
  const add = useAddAllergy(who);
  const remove = useRemove(who, 'allergies');
  const [substance, setSubstance] = useState('');
  const [severity, setSeverity] = useState<keyof typeof severityLevel>('moderate');
  return (
    <>
      <SectionLabel>{t('health.allergies')}</SectionLabel>
      <Card style={{ gap: space[3] }}>
        {items.length === 0 ? <Text tone="muted">{t('healthTab.noAllergies')}</Text> : null}
        {items.map((a) => (
          <View key={a.id} style={{ flexDirection: 'row', alignItems: 'center', gap: space[2] }}>
            <Text weight="bold" style={{ flex: 1 }}>
              {a.substance}
            </Text>
            <StatusChip level={severityLevel[a.severity]} label={t(`health.severity.${a.severity}`)} />
            <IconButton icon="trash" label={t('healthTab.remove', { name: a.substance })} onPress={() => remove.mutate(a.id)} />
          </View>
        ))}
        <TextField label={t('healthTab.newAllergy')} value={substance} onChangeText={setSubstance} maxLength={120} />
        <Segmented label={t('healthTab.severityLabel')} options={(['mild', 'moderate', 'severe'] as const).map((v) => ({ value: v, label: t(`health.severity.${v}`) }))} value={severity} onChange={setSeverity} />
        <Button label={t('healthTab.add')} tone="neutral" disabled={!substance.trim() || add.isPending} onPress={() => add.mutate({ substance: substance.trim(), severity }, { onSuccess: () => setSubstance('') })} />
      </Card>
    </>
  );
}

function Devices({ who }: { who: string }) {
  const { t } = useTranslation();
  const { space } = useTheme();
  const list = useHealthList(who, 'devices');
  const devices = list.data?.devices ?? [];
  return (
    <>
      <SectionLabel>{t('healthTab.devices')}</SectionLabel>
      <Card style={{ gap: space[3] }}>
        {devices.length === 0 ? <Text tone="muted">{t('health.none')}</Text> : null}
        {devices.map((d) => (
          <View key={d.id} style={{ flexDirection: 'row', alignItems: 'center', gap: space[3] }}>
            <Icon name="device" />
            <View style={{ flex: 1 }}>
              <Text weight="bold">{d.name}</Text>
              <Text variant="small" tone="muted">
                {t(`healthTab.sources.${d.connection}`)}
              </Text>
            </View>
          </View>
        ))}
      </Card>
    </>
  );
}

function Vaccinations({ who, lng }: { who: string; lng: string }) {
  const { t } = useTranslation();
  const { space } = useTheme();
  const list = useHealthList(who, 'vaccinations');
  const items = list.data?.vaccinations ?? [];
  return (
    <>
      <SectionLabel>{t('healthTab.vaccinations')}</SectionLabel>
      <Card style={{ gap: space[3] }}>
        {items.length === 0 ? <Text tone="muted">{t('health.none')}</Text> : null}
        {items.map((v) => (
          <View key={v.id} style={{ flexDirection: 'row', alignItems: 'center', gap: space[3] }}>
            <Icon name="syringe" />
            <View style={{ flex: 1 }}>
              <Text weight="bold">{[v.name, v.doseLabel].filter(Boolean).join(' · ')}</Text>
              <Text variant="small" tone="muted">
                {[v.givenOn ? shortDate(v.givenOn, lng) : null, v.nextDue ? `→ ${shortDate(v.nextDue, lng)}` : null].filter(Boolean).join('  ')}
              </Text>
            </View>
            {v.dueSoon ? <StatusChip level="warn" label={t('healthTab.dueSoon')} /> : null}
          </View>
        ))}
      </Card>
    </>
  );
}

function InsuranceCards({ who, lng }: { who: string; lng: string }) {
  const { t } = useTranslation();
  const { space } = useTheme();
  const list = useHealthList(who, 'insurance');
  const [open, setOpen] = useState<string | null>(null);
  const policies = list.data?.policies ?? [];
  return (
    <>
      <SectionLabel>{t('healthTab.insurance')}</SectionLabel>
      {policies.length === 0 ? <Card><Text tone="muted">{t('health.none')}</Text></Card> : null}
      {policies.map((p) => (
        <Card key={p.id} style={{ gap: space[2] }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: space[3] }}>
            <Icon name="card" />
            <View style={{ flex: 1 }}>
              <Text weight="bold">{p.insurer}</Text>
              {p.validUntil ? (
                <Text variant="small" tone="muted">
                  {t('healthTab.validUntil', { date: shortDate(p.validUntil, lng) })}
                </Text>
              ) : null}
            </View>
            {p.expired ? <StatusChip level="danger" label={t('healthTab.expired')} /> : null}
          </View>
          {open === p.id ? (
            <View style={{ gap: space[1] }}>
              {p.policyNumber ? <Text variant="small">{`${t('healthTab.policy')}: ${p.policyNumber}`}</Text> : null}
              {p.memberId ? <Text variant="small">{`${t('healthTab.member')}: ${p.memberId}`}</Text> : null}
            </View>
          ) : null}
          <Button tone="neutral" label={open === p.id ? t('healthTab.hideDetails') : t('healthTab.showDetails')} onPress={() => setOpen(open === p.id ? null : p.id)} />
        </Card>
      ))}
    </>
  );
}
