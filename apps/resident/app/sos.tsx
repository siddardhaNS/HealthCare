import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, BackHandler, Pressable, ScrollView, useWindowDimensions, Vibration, View } from 'react-native';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { SafeAreaView } from 'react-native-safe-area-context';
import { checkTransition, crewSteps, type SosState } from '@repo/contracts/sos';
import { Button, Card, Icon, Screen, Text, useTheme } from '@repo/ui-native';
import { km, SosMap } from '../lib/sos-map';
import { useCancelSos, useCurrentSos, useDeskPhone, useLiveSos, useRaiseSos, useSosLocation, type ResidentSos } from '../lib/sos';
import { dial, EmergencyCalls } from '../lib/emergency-calls';
import { Loading } from '../lib/ui';

const COUNTDOWN_S = 5;

/** Seconds since `iso`, ticking. */
function useElapsed(iso: string | undefined) {
  const [now, setNow] = useState(Date.now());
  // A phone clock behind the server would put the start in the future and
  // freeze the timer at 0:00; start no later than when this phone first saw it.
  const anchor = useRef<{ iso: string; at: number } | null>(null);
  if (iso && anchor.current?.iso !== iso) anchor.current = { iso, at: Math.min(Date.parse(iso), Date.now()) };
  useEffect(() => {
    const iv = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(iv);
  }, []);
  return anchor.current ? Math.max(0, Math.floor((now - anchor.current.at) / 1000)) : 0;
}
const mmss = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

/** Leave the SOS screen without ever stranding the person on it. */
const goHome = () => (router.canGoBack() ? router.back() : router.replace('/'));

// Design: Resident app › SOS confirm, then SOS (live). Plan §3.1–3.2, §3.6.
export default function Sos() {
  const current = useCurrentSos();
  const [id, setId] = useState<string | null>(current.data?.id ?? null);
  // An SOS already open (another device, or a family manager raised it) goes straight to the live view.
  useEffect(() => {
    if (!id && current.data) setId(current.data.id);
  }, [id, current.data]);

  return id ? <LiveSos id={id} /> : <Countdown onSent={setId} />;
}

// ── Countdown and raising ───────────────────────────────────────────────

function Countdown({ onSent }: { onSent: (id: string) => void }) {
  const { t } = useTranslation();
  const { colors, space, radius, fonts } = useTheme();
  const bestLocation = useSosLocation();
  const { state, send } = useRaiseSos();
  const [count, setCount] = useState(COUNTDOWN_S);
  const started = state.status !== 'idle';

  useEffect(() => {
    Vibration.vibrate(400);
  }, []);
  useEffect(() => {
    if (started) return;
    if (count <= 0) {
      void send(bestLocation());
      return;
    }
    const tm = setTimeout(() => setCount((c) => c - 1), 1000);
    return () => clearTimeout(tm);
  }, [count, started, send, bestLocation]);
  useEffect(() => {
    if (state.status === 'sent') onSent(state.incident.id);
  }, [state, onSent]);
  // Once sending, the back button must not drop the SOS: retries run while this screen is open.
  useEffect(() => {
    if (!started) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => true);
    return () => sub.remove();
  }, [started]);

  const fallbacks = (state.status === 'sending' && state.slow) || state.status === 'refused';

  return (
    <Screen style={{ backgroundColor: colors.dangerSoft }}>
      <SafeAreaView style={{ flex: 1 }}>
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: space[5] + 2, paddingHorizontal: space[6] }}>
          {!started ? (
            <>
              <Text variant="small" tone="muted" style={{ textAlign: 'center' }}>
                {t('sos.confirmLead')}
              </Text>
              <View
                accessible
                accessibilityLiveRegion="assertive"
                accessibilityLabel={t('sos.countdownA11y', { count })}
                style={{ width: 128, height: 128, borderRadius: radius.pill, borderWidth: 6, borderColor: colors.danger, alignItems: 'center', justifyContent: 'center' }}
              >
                <Text variant="hero" tone="danger" style={{ fontFamily: fonts.mono.native.bold }}>
                  {count}
                </Text>
              </View>
              <Text style={{ textAlign: 'center', maxWidth: 300 }}>{t('sos.confirmNote')}</Text>
            </>
          ) : (
            <>
              {state.status === 'refused' ? null : <ActivityIndicator size="large" color={colors.danger} />}
              <Text variant="h3" style={{ textAlign: 'center' }} accessibilityLiveRegion="polite">
                {state.status === 'refused' ? t('sos.refused') : fallbacks ? t('sos.slow') : t('sos.sending')}
              </Text>
            </>
          )}
        </View>
        <View style={{ padding: space[5], gap: space[3] }}>
          {!started ? (
            <>
              <Button label={t('sos.sendNow')} tone="danger" onPress={() => void send(bestLocation())} testID="sos-send-now" />
              <Button label={t('sos.imOk')} tone="neutral" onPress={goHome} testID="sos-im-ok" />
            </>
          ) : fallbacks ? (
            <EmergencyCalls />
          ) : null}
        </View>
      </SafeAreaView>
    </Screen>
  );
}

// ── Live SOS ────────────────────────────────────────────────────────────

const isOpen = (s: SosState) => s !== 'closed' && s !== 'cancelled';
/** Still waiting for a crew to accept. */
const finding = (s: SosState) => s === 'raised' || s === 'dispatching' || s === 'escalated_to_108';
/** The map and ETA matter until the ambulance is at the door. */
const approaching = (s: SosState) => finding(s) || s === 'accepted' || s === 'en_route';

function LiveSos({ id }: { id: string }) {
  const { t } = useTranslation();
  const { colors, space, radius } = useTheme();
  const { width } = useWindowDimensions();
  const sos = useLiveSos(id);
  const cancel = useCancelSos(id);
  const deskPhone = useDeskPhone();
  const [confirmCancel, setConfirmCancel] = useState(false);
  const elapsed = useElapsed(sos.data?.createdAt);

  if (!sos.data) return <Screen style={{ justifyContent: 'center' }}>{sos.isError ? <OfflineFallback /> : <Loading />}</Screen>;
  const s = sos.data;
  const open = isOpen(s.state);
  const canCancel = checkTransition(s.state, 'cancelled', 'resident').ok;

  return (
    <Screen testID="sos-live">
      <SafeAreaView style={{ flex: 1 }} edges={['top', 'bottom']}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space[3], padding: space[4], backgroundColor: open ? colors.dangerSoft : colors.surface }}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('sos.minimise')}
            onPress={goHome}
            style={{ width: 44, height: 44, borderRadius: radius.sm, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surface }}
          >
            <View style={{ transform: [{ rotate: '90deg' }] }}>
              <Icon name="chevronRight" color={colors.text} />
            </View>
          </Pressable>
          <View style={{ flex: 1 }} accessibilityLiveRegion="polite">
            <Text variant="title" tone={open ? 'danger' : 'default'}>
              {t(`sos.title.${s.state}`)}
            </Text>
            <Text variant="small" tone="muted">
              {t(`sos.subtitle.${s.state}`)}
            </Text>
          </View>
          {open ? (
            <Text variant="title" tone="danger" style={{ fontVariant: ['tabular-nums'] }} accessibilityLabel={t('sos.elapsed', { time: mmss(elapsed) })}>
              {mmss(elapsed)}
            </Text>
          ) : null}
        </View>

        <ScrollView contentContainerStyle={{ paddingTop: space[3], paddingBottom: space[4], gap: space[3] }}>
          {s.isDrill ? (
            <View style={{ backgroundColor: colors.warningSoft, padding: space[3], alignItems: 'center' }}>
              <Text weight="bold" style={{ color: colors.warningText }}>
                {t('sos.drill')}
              </Text>
            </View>
          ) : null}

          {s.state === 'escalated_to_108' ? (
            <Card style={{ marginHorizontal: space[5], gap: space[3], backgroundColor: colors.dangerSoft, borderColor: colors.dangerBorder }} accessibilityLiveRegion="assertive">
              <Text weight="bold" tone="danger">
                {t('sos.escalatedBanner')}
              </Text>
              <Button label={t('sos.call108')} tone="danger" onPress={() => dial('108')} />
            </Card>
          ) : null}

          {approaching(s.state) ? <SosMap you={s.location} ambulance={s.crew?.position ?? null} distanceM={s.crew?.distanceM ?? null} width={width} /> : null}

          <View style={{ paddingHorizontal: space[5], gap: space[3] }}>
            {open && s.state !== 'handed_over' ? <EtaCard sos={s} elapsed={elapsed} /> : null}
            <Steps sos={s} />
            {open ? (
              <Card style={{ gap: space[1], flexDirection: 'row', alignItems: 'flex-start' }}>
                <Icon name="doc" color={colors.textMuted} size={18} />
                <View style={{ flex: 1, gap: space[1] }}>
                  <Text weight="bold">{t('sos.erTitle')}</Text>
                  <Text variant="small" tone="muted">
                    {t('sos.erPending')}
                  </Text>
                </View>
              </Card>
            ) : null}
            {open && !sos.connected ? (
              <Text variant="caption" tone="muted" accessibilityLiveRegion="polite">
                {t('sos.liveOff')}
              </Text>
            ) : null}
            {cancel.isError ? (
              <Text variant="small" tone="danger">
                {cancel.error.message}
              </Text>
            ) : null}
          </View>
        </ScrollView>

        {/* In the fixed footer, so the question appears right where "Cancel SOS" was pressed. */}
        {confirmCancel && canCancel ? (
          <Card style={{ gap: space[3], marginHorizontal: space[4] }} accessibilityLiveRegion="polite">
            <Text>{t('sos.cancelConfirm')}</Text>
            <Button testID="sos-cancel-yes" label={t('sos.cancelYes')} tone="danger" disabled={cancel.isPending} onPress={() => cancel.mutate(undefined, { onSettled: () => setConfirmCancel(false) })} />
            <Button label={t('sos.cancelNo')} tone="neutral" onPress={() => setConfirmCancel(false)} />
          </Card>
        ) : null}
        <View style={{ flexDirection: 'row', gap: space[3], padding: space[4], paddingTop: space[2] }}>
          {!open ? (
            <Button label={t('sos.done')} tone="accent" style={{ flex: 1 }} onPress={goHome} />
          ) : (
            <>
              {canCancel ? (
                <Button testID="sos-cancel" label={t('sos.cancel')} tone="neutral" style={{ flex: 1 }} onPress={() => setConfirmCancel(true)} disabled={confirmCancel} />
              ) : (
                <Button label={t('sos.call108')} tone="neutral" style={{ flex: 1 }} onPress={() => dial('108')} />
              )}
              {deskPhone ? (
                <Button label={t('sos.callDeskShort')} tone="danger" style={{ flex: 1 }} onPress={() => dial(deskPhone)} />
              ) : canCancel ? (
                <Button label={t('sos.call108')} tone="danger" style={{ flex: 1 }} onPress={() => dial('108')} />
              ) : null}
            </>
          )}
        </View>
      </SafeAreaView>
    </Screen>
  );
}

/** The SOS was sent but cannot be loaded (network): the phone fallbacks still work. */
function OfflineFallback() {
  const { t } = useTranslation();
  const { space } = useTheme();
  return (
    <View style={{ padding: space[5], gap: space[3] }}>
      <Text variant="h3">{t('sos.slow')}</Text>
      <EmergencyCalls />
    </View>
  );
}

function EtaCard({ sos, elapsed }: { sos: ResidentSos; elapsed: number }) {
  const { t } = useTranslation();
  const { colors, space, radius, fonts } = useTheme();
  const crew = sos.crew;
  if (!crew) {
    if (!finding(sos.state)) return null;
    return (
      <Card style={{ flexDirection: 'row', alignItems: 'center', gap: space[3] }}>
        <ActivityIndicator color={colors.danger} />
        <View style={{ flex: 1 }}>
          <Text weight="bold">{t('sos.findingLabel')}</Text>
          <Text variant="small" tone="muted">
            {t('sos.elapsed', { time: mmss(elapsed) })}
          </Text>
        </View>
      </Card>
    );
  }
  const minutes = crew.etaS !== null ? Math.max(1, Math.ceil(crew.etaS / 60)) : null;
  const meta = [crew.distanceM !== null && approaching(sos.state) ? t('sos.distance', { km: km(crew.distanceM) }) : null, crew.ambulance ? t(`sos.equipment.${crew.ambulance.equipment}`) : null].filter(Boolean).join(' · ');
  return (
    <Card style={{ gap: space[3] }}>
      <View>
        {approaching(sos.state) ? (
          <>
            <Text variant="small" tone="muted">
              {t('sos.etaLabel')}
            </Text>
            <Text variant="h1" tone="danger">
              {minutes !== null ? t('sos.etaMinutes', { count: minutes }) : t('sos.etaUnknown')}
            </Text>
          </>
        ) : (
          <Text variant="h3">{t(`sos.title.${sos.state}`)}</Text>
        )}
      </View>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'baseline', columnGap: space[3] }}>
        {crew.ambulance ? <Text style={{ fontFamily: fonts.mono.native.semibold }}>{crew.ambulance.registration}</Text> : null}
        <Text variant="small" tone="muted">
          {meta}
        </Text>
      </View>
      {crew.workPhone ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('sos.callCrew')}
          onPress={() => dial(crew.workPhone!)}
          style={({ pressed }) => ({
            flexDirection: 'row',
            alignItems: 'center',
            gap: space[3],
            minHeight: 48,
            paddingHorizontal: space[4],
            borderRadius: radius.control,
            backgroundColor: colors.danger,
            opacity: pressed ? 0.85 : 1,
          })}
        >
          <Icon name="phone" color={colors.onDanger} size={18} />
          <Text weight="bold" tone="onDanger">
            {t('sos.callCrew')}
          </Text>
        </Pressable>
      ) : null}
    </Card>
  );
}

/** Progress as the design lists it: done steps with their time, the current one marked "now". */
function Steps({ sos }: { sos: ResidentSos }) {
  const { t, i18n } = useTranslation();
  const { colors, space } = useTheme();
  const order: SosState[] = ['raised', 'dispatching', 'accepted', ...crewSteps];
  const reachedAt = new Map(sos.timeline.map((e) => [e.to, e.at] as const));
  // Waiting for an accept after the 108 prompt is still the dispatching step.
  const current: SosState = sos.state === 'escalated_to_108' ? 'dispatching' : sos.state;
  const curIdx = order.indexOf(current);
  const time = (iso: string) => new Intl.DateTimeFormat(`${i18n.language}-IN`, { hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata' }).format(new Date(iso));
  const shown = isOpen(sos.state) ? order : order.filter((s) => reachedAt.has(s));

  return (
    <View style={{ gap: space[2] + 1 }} accessibilityRole="list">
      {shown.map((step, i) => {
        // Handed over is the last step: it is done, not in progress.
        const done = isOpen(sos.state) && sos.state !== 'handed_over' ? i < curIdx : reachedAt.has(step);
        const now = isOpen(sos.state) && sos.state !== 'handed_over' && i === curIdx;
        const at = reachedAt.get(step);
        return (
          <View key={step} style={{ flexDirection: 'row', alignItems: 'center', gap: space[3] }}>
            <View
              style={{
                width: 22,
                height: 22,
                borderRadius: 11,
                alignItems: 'center',
                justifyContent: 'center',
                ...(done ? { backgroundColor: colors.accentSoft } : { borderWidth: 2, borderColor: now ? colors.danger : colors.border }),
              }}
            >
              {done ? <Icon name="check" color={colors.accentText} size={12} strokeWidth={3} /> : null}
            </View>
            <Text variant="small" weight={now ? 'bold' : 'regular'} tone={done || now ? 'default' : 'muted'} style={{ flex: 1 }}>
              {t(`sos.steps.${step}`)}
            </Text>
            <Text variant="caption" tone={now ? 'danger' : 'muted'}>
              {at && (done || now) ? time(at) : now ? t('sos.now') : ''}
            </Text>
          </View>
        );
      })}
    </View>
  );
}
