import { useEffect, useRef, useState } from 'react';
import { AppState, ScrollView, Switch, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { SafeAreaView } from 'react-native-safe-area-context';
import { isFieldRole, type FieldRole } from '@repo/contracts/roles';
import { useSession } from '@repo/mobile';
import { Button, Card, Screen, Text, useTheme } from '@repo/ui-native';
import { JobPanel } from '../components/job-panel';
import { OfferRinging } from '../components/offer-ringing';
import { ApiError, useCrewJob, useCrewStatus, useOffers, useSetDuty } from '../lib/data';
import { currentPoint, isTrackingJob, startJobTracking, stopJobTracking, watchStandby } from '../lib/location';

/** Role-based home. Ambulance crew get duty, offers and jobs; the other roles' jobs come in Phase 5. */
export default function FieldHome() {
  const { t } = useTranslation();
  const { space } = useTheme();
  const { api, supabase } = useSession();
  const [role, setRole] = useState<FieldRole | null | 'loading' | 'error'>('loading');

  useEffect(() => {
    void api.GET('/v1/me').then(({ data }) => setRole(data ? (data.roles.find(isFieldRole) ?? null) : 'error'));
  }, [api]);

  const signOut = () => void supabase.auth.signOut();

  if (role === 'loading') return <Screen />;
  if (role === 'crew') return <CrewHome onSignOut={signOut} />;

  return (
    <Screen>
      <SafeAreaView style={{ flex: 1, padding: space[5], paddingTop: space[16], gap: space[5] }}>
        <Text variant="h3">{t('field.title')}</Text>
        {role === null || role === 'error' ? (
          <Text tone="muted">{role === null ? t('auth.fieldOnly') : t('auth.genericError')}</Text>
        ) : (
          <>
            <Text tone="muted">{t(`field.roles.${role}`)}</Text>
            <Card>
              <Text tone="muted">{t('field.laterRoles')}</Text>
            </Card>
          </>
        )}
        <Button label={t('auth.signOut')} tone="neutral" onPress={signOut} />
      </SafeAreaView>
    </Screen>
  );
}

/** True while the app is in the foreground. */
function useAppActive() {
  const [active, setActive] = useState(AppState.currentState === 'active');
  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => setActive(s === 'active'));
    return () => sub.remove();
  }, []);
  return active;
}

function CrewHome({ onSignOut }: { onSignOut: () => void }) {
  const { t } = useTranslation();
  const { colors, space } = useTheme();
  const { api } = useSession();
  const active = useAppActive();

  const status = useCrewStatus();
  const onDuty = status.data?.onDuty ?? false;
  const job = useCrewJob(!!status.data);
  const current = job.data ?? null;
  const offers = useOffers(onDuty && job.isSuccess && current === null && active);
  const setDuty = useSetDuty();
  const [notice, setNotice] = useState<string | null>(null);
  const [tracking, setTracking] = useState<boolean | null>(null);
  const [locating, setLocating] = useState(false);

  // Standby: share position while on duty, free and in the foreground.
  useEffect(() => {
    if (!onDuty || current || !active) return;
    let stop: (() => void) | undefined;
    let cancelled = false;
    void watchStandby(api).then((s) => (cancelled ? s() : (stop = s)));
    return () => {
      cancelled = true;
      stop?.();
    };
  }, [api, onDuty, current, active]);

  // Active job: background tracking with the visible notification; stopped once the job is over.
  const jobId = current?.incident.id ?? null;
  useEffect(() => {
    if (!job.isSuccess) return;
    if (jobId) {
      void startJobTracking(api, { title: t('field.trackingTitle'), body: t('field.trackingBody') })
        .catch(() => false)
        .then(setTracking);
    } else {
      void stopJobTracking().then(() => setTracking(null));
    }
  }, [api, jobId, job.isSuccess, t]);

  // Re-check after returning from Settings or Google Maps.
  useEffect(() => {
    if (active && jobId) void isTrackingJob().then(setTracking);
  }, [active, jobId]);

  // A job that disappears without being handed over was cancelled or reassigned by the desk.
  const lastJob = useRef<{ id: string; nextStep: string | null } | null>(null);
  useEffect(() => {
    if (!job.isSuccess) return;
    const was = lastJob.current;
    if (was && !current && was.nextStep !== 'handed_over') setNotice(t('field.jobEnded'));
    lastJob.current = current ? { id: current.incident.id, nextStep: current.nextStep } : null;
  }, [current, job.isSuccess, t]);

  const toggleDuty = async (on: boolean) => {
    setNotice(null);
    // A location fix can take seconds: keep the switch locked meanwhile, so a second tap doesn't undo the first.
    setLocating(on);
    const location = on ? await currentPoint().finally(() => setLocating(false)) : null;
    if (on && !location) setNotice(t('field.locationNeeded'));
    setDuty.mutate(
      { onDuty: on, ...(location ? { location } : {}) },
      { onError: (e) => setNotice(e instanceof ApiError && e.status === 409 ? t('field.offDutyBlocked') : t('field.networkError')) },
    );
  };

  if (status.isPending) return <Screen />;
  if (status.error) {
    const notCrew = status.error instanceof ApiError && status.error.status === 403;
    return (
      <Screen>
        <SafeAreaView style={{ flex: 1, padding: space[5], paddingTop: space[16], gap: space[5] }}>
          <Text variant="h3">{t('field.title')}</Text>
          <Text tone="muted">{notCrew ? t('field.notCrew') : t('field.networkError')}</Text>
          {notCrew ? null : <Button label={t('field.ok')} onPress={() => void status.refetch()} />}
          <Button label={t('auth.signOut')} tone="neutral" onPress={onSignOut} />
        </SafeAreaView>
      </Screen>
    );
  }

  const ringing = !current ? offers.data?.[0] : undefined;
  if (ringing) return <OfferRinging key={ringing.id} offer={ringing} />;

  return (
    <Screen>
      <SafeAreaView style={{ flex: 1 }} edges={['top']}>
        <ScrollView contentContainerStyle={{ paddingHorizontal: space[5], paddingTop: space[6], paddingBottom: space[8], gap: space[4] }}>
          <View accessibilityRole="header">
            <Text variant="small" tone="muted">
              {t('field.roles.crew')}
              {status.data.team ? ` · ${status.data.team}` : ''}
            </Text>
            <Text variant="h3">{t('field.title')}</Text>
          </View>

          <Card style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <Text variant="bodyLg" weight="bold" tone={onDuty ? 'accent' : 'muted'}>
              {locating ? t('field.locating') : onDuty ? t('field.onDuty') : t('field.offDuty')}
            </Text>
            <Switch
              accessibilityLabel={t('field.onDuty')}
              value={onDuty}
              disabled={setDuty.isPending || locating}
              onValueChange={(v) => void toggleDuty(v)}
              trackColor={{ false: colors.borderStrong, true: colors.accent }}
              thumbColor={colors.text}
            />
          </Card>

          {notice ? (
            <Card style={{ gap: space[3] }}>
              <Text accessibilityLiveRegion="polite">{notice}</Text>
              <Button label={t('field.ok')} tone="neutral" onPress={() => setNotice(null)} />
            </Card>
          ) : null}

          {current ? (
            <JobPanel job={current} tracking={tracking} />
          ) : (
            <Card style={{ gap: space[2] }}>
              <Text tone="muted">{t('field.noJobs')}</Text>
              {onDuty ? (
                <Text variant="small" tone="muted">
                  {t('field.standbyHint')}
                </Text>
              ) : null}
            </Card>
          )}

          {current ? null : <Button label={t('auth.signOut')} tone="neutral" onPress={onSignOut} />}
        </ScrollView>
      </SafeAreaView>
    </Screen>
  );
}
