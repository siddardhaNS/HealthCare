import { useState } from 'react';
import { Linking, Switch, View } from 'react-native';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { consentPurposes, purposeMeta, type ConsentPurpose } from '@repo/contracts/consent';
import { useSession } from '@repo/mobile';
import { Button, Card, Text, TextField, useTheme } from '@repo/ui-native';
import {
  ApiError,
  useAddContact,
  useConsentHistory,
  useConsents,
  useContacts,
  useHealthSummary,
  useHousehold,
  useInvite,
  useMyId,
  useProfile,
  useRemoveContact,
  useRevokeInvite,
  useSetConsent,
} from '../../lib/data';
import { initials, shortDateTime } from '../../lib/format';
import { IconButton, Page, SectionLabel, StatusChip } from '../../lib/ui';

/** Consents a person switches on and off here (core record and per-booking ones are handled elsewhere). */
const switchable = consentPurposes.filter((p) => purposeMeta[p].standing && !purposeMeta[p].required);

// Design: Resident app › Profile, with family, privacy and consent history.
export default function Profile() {
  const { t, i18n } = useTranslation();
  const { colors, space, radius } = useTheme();
  const { supabase } = useSession();
  const me = useMyId();
  const profile = useProfile();
  const household = useHousehold();
  const summary = useHealthSummary(me);
  const h = household.data?.household;
  const home = h?.community ? `${[h.home?.tower, h.home?.number].filter(Boolean).join('-')}, ${h.community.name}` : (h?.city ?? '');

  return (
    <Page refreshing={household.isRefetching} onRefresh={() => void household.refetch()}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space[3] }} accessibilityRole="header">
        <View style={{ width: 56, height: 56, borderRadius: radius.md, backgroundColor: colors.accentSoft, alignItems: 'center', justifyContent: 'center' }}>
          <Text variant="title" tone="accent">
            {initials(profile.data?.fullName)}
          </Text>
        </View>
        <View style={{ flex: 1 }}>
          <Text variant="h3">{profile.data?.fullName ?? ''}</Text>
          <Text variant="small" tone="muted">
            {[summary.data?.age, home].filter(Boolean).join(' · ')}
          </Text>
        </View>
      </View>

      <Card style={{ gap: space[2] }}>
        <Fact label={t('health.bloodGroup')} value={summary.data?.profile.bloodGroup ?? '—'} />
        <Fact label={t('health.conditions')} value={summary.data?.conditions.map((c) => c.name).join(', ') || '—'} />
        <Fact label={t('health.allergies')} value={summary.data?.allergies.map((a) => a.substance).join(', ') || t('healthTab.noAllergies')} danger={!!summary.data?.allergies.length} />
      </Card>
      <Button label={t('profileTab.healthRecord')} tone="neutral" onPress={() => router.push('/health')} />

      <Contacts who={me} />
      <Family />
      <Privacy />
      <History lng={i18n.language} />

      <Button label={t('auth.signOut')} tone="neutral" onPress={() => void supabase.auth.signOut()} style={{ marginTop: space[4] }} />
    </Page>
  );
}

function Fact({ label, value, danger }: { label: string; value: string; danger?: boolean }) {
  const { space } = useTheme();
  return (
    <View style={{ flexDirection: 'row', gap: space[3] }}>
      <Text variant="small" tone="muted" style={{ width: 110 }}>
        {label}
      </Text>
      <Text variant="small" weight="semibold" tone={danger ? 'danger' : 'default'} style={{ flex: 1 }}>
        {value}
      </Text>
    </View>
  );
}

function Contacts({ who }: { who: string }) {
  const { t } = useTranslation();
  const { space } = useTheme();
  const contacts = useContacts(who);
  const add = useAddContact(who);
  const remove = useRemoveContact(who);
  const [f, setF] = useState({ name: '', relation: '', phone: '' });
  const digits = f.phone.replace(/\D/g, '');
  const error = add.error instanceof ApiError ? add.error.message : add.isError ? t('common.error') : null;
  return (
    <>
      <SectionLabel>{t('profileTab.emergencyContacts')}</SectionLabel>
      <Card style={{ gap: space[3] }}>
        {(contacts.data?.contacts ?? []).map((c) => (
          <View key={c.id} style={{ flexDirection: 'row', alignItems: 'center', gap: space[2] }}>
            <Text weight="bold" style={{ flex: 1 }}>
              {[c.name, c.relation].filter(Boolean).join(' · ')}
            </Text>
            <Button label={t('profileTab.call')} tone="neutral" onPress={() => void Linking.openURL(`tel:${c.phone}`)} />
            <IconButton icon="trash" label={`${t('profileTab.remove')} ${c.name}`} onPress={() => remove.mutate(c.id)} />
          </View>
        ))}
        <TextField label={t('profileTab.contactName')} value={f.name} onChangeText={(v) => setF((p) => ({ ...p, name: v }))} maxLength={80} />
        <TextField label={t('profileTab.contactRelation')} value={f.relation} onChangeText={(v) => setF((p) => ({ ...p, relation: v }))} maxLength={40} />
        <TextField label={t('profileTab.contactPhone')} prefix="+91" value={f.phone} onChangeText={(v) => setF((p) => ({ ...p, phone: v.replace(/\D/g, '').slice(0, 10) }))} keyboardType="phone-pad" maxLength={10} />
        {error ? <Text tone="danger">{error}</Text> : null}
        <Button
          label={t('profileTab.addContact')}
          tone="neutral"
          disabled={!f.name.trim() || !/^[6-9]\d{9}$/.test(digits) || add.isPending}
          onPress={() => add.mutate({ name: f.name.trim(), relation: f.relation.trim() || undefined, phone: `+91${digits}`, priority: 1 }, { onSuccess: () => setF({ name: '', relation: '', phone: '' }) })}
        />
      </Card>
    </>
  );
}

function Family() {
  const { t } = useTranslation();
  const { colors, space } = useTheme();
  const household = useHousehold();
  const invite = useInvite();
  const revoke = useRevokeInvite();
  const setConsent = useSetConsent();
  const [phone, setPhone] = useState('');
  const [relation, setRelation] = useState('');
  const data = household.data;
  const error = invite.error instanceof ApiError ? invite.error.message : invite.isError ? t('common.error') : null;
  return (
    <>
      <SectionLabel>{t('profileTab.family')}</SectionLabel>
      <Card style={{ gap: space[3] }}>
        {(data?.members ?? []).map((m) => (
          <View key={m.userId} style={{ gap: space[1] }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: space[2] }}>
              <Text weight="bold" style={{ flex: 1 }}>
                {m.isMe ? t('profileTab.you') : [m.fullName ?? '—', m.relation].filter(Boolean).join(' · ')}
              </Text>
              {!m.isMe ? (
                <Switch
                  accessibilityLabel={`${t('profileTab.makeManager')}: ${m.fullName ?? ''}`}
                  value={m.managesMe}
                  disabled={setConsent.isPending}
                  onValueChange={(v) => setConsent.mutate({ purpose: 'manager', scopeKey: m.userId, granted: v })}
                  trackColor={{ false: colors.borderStrong, true: colors.accent }}
                  thumbColor={colors.text}
                />
              ) : null}
            </View>
            {!m.isMe ? (
              <Text variant="caption" tone="muted">
                {/* The manager notice the person agrees to when switching this on. */}
                {[t('consent.manager.body', { name: m.fullName ?? m.relation ?? '—' }), m.iManage ? t('profileTab.youManage') : null].filter(Boolean).join(' ')}
              </Text>
            ) : null}
          </View>
        ))}
        {data?.invites.length ? (
          <>
            <Text variant="small" weight="bold" tone="muted">
              {t('profileTab.pendingInvites')}
            </Text>
            {data.invites.map((i) => (
              <View key={i.id} style={{ flexDirection: 'row', alignItems: 'center', gap: space[2] }}>
                <Text style={{ flex: 1 }}>{[i.phone, i.relation].filter(Boolean).join(' · ')}</Text>
                <Button label={t('profileTab.cancel')} tone="neutral" onPress={() => revoke.mutate(i.id)} />
              </View>
            ))}
          </>
        ) : null}
        <TextField label={t('profileTab.invitePhone')} prefix="+91" value={phone} onChangeText={(v) => setPhone(v.replace(/\D/g, '').slice(0, 10))} keyboardType="phone-pad" maxLength={10} />
        <TextField label={t('profileTab.inviteRelation')} value={relation} onChangeText={setRelation} maxLength={40} />
        {error ? <Text tone="danger">{error}</Text> : null}
        <Button
          label={t('profileTab.sendInvite')}
          tone="neutral"
          disabled={!/^[6-9]\d{9}$/.test(phone) || invite.isPending}
          onPress={() => invite.mutate({ phone: `+91${phone}`, relation: relation.trim() || undefined }, { onSuccess: () => { setPhone(''); setRelation(''); } })}
        />
      </Card>
    </>
  );
}

function Privacy() {
  const { t } = useTranslation();
  const { colors, space } = useTheme();
  const consents = useConsents();
  const setConsent = useSetConsent();
  const state = (p: ConsentPurpose) => consents.data?.consents.find((c) => c.purpose === p && c.scopeKey === '');
  return (
    <>
      <SectionLabel>{t('profileTab.privacy')}</SectionLabel>
      <Card style={{ gap: space[4] }}>
        {switchable.map((p) => {
          const s = state(p);
          // A consent given to an older notice shows as off until agreed again.
          const on = s?.status === 'granted' && !s.outdated;
          return (
            <View key={p} style={{ flexDirection: 'row', gap: space[3], alignItems: 'flex-start' }}>
              <View style={{ flex: 1, gap: space[1] }}>
                <Text weight="bold">{t(`consent.${p}.title`)}</Text>
                <Text variant="small" tone="muted">
                  {t(`consent.${p}.body`)}
                </Text>
                {s?.outdated ? <StatusChip level="warn" label={t('console.residents.outdated')} /> : null}
              </View>
              <Switch
                accessibilityLabel={t(`consent.${p}.title`)}
                value={on}
                disabled={setConsent.isPending}
                onValueChange={(v) => setConsent.mutate({ purpose: p, granted: v })}
                trackColor={{ false: colors.borderStrong, true: colors.accent }}
                thumbColor={colors.text}
              />
            </View>
          );
        })}
      </Card>
    </>
  );
}

function History({ lng }: { lng: string }) {
  const { t } = useTranslation();
  const { space } = useTheme();
  const history = useConsentHistory();
  const events = (history.data?.events ?? []).slice(0, 10);
  return (
    <>
      <SectionLabel>{t('profileTab.history')}</SectionLabel>
      <Card style={{ gap: space[2] }}>
        {events.length === 0 ? <Text tone="muted">{t('profileTab.historyEmpty')}</Text> : null}
        {events.map((e, i) => (
          <View key={`${e.createdAt}-${i}`}>
            <Text variant="small">{t(e.status === 'granted' ? 'profileTab.historyGranted' : 'profileTab.historyWithdrawn', { title: t(`consent.${e.purpose}.title`, { name: '' }) })}</Text>
            <Text variant="caption" tone="muted">
              {shortDateTime(e.createdAt, lng)}
            </Text>
          </View>
        ))}
      </Card>
    </>
  );
}
