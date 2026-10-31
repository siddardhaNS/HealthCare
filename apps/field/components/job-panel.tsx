import { useState } from 'react';
import { Linking, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import type { Schemas } from '@repo/api-client';
import { Button, Card, Text, useTheme } from '@repo/ui-native';
import { ApiError, useAdvanceJob } from '../lib/data';
import { canPickHospital, HospitalPicker } from './hospital-picker';
import { FirstAidNotes, PatientSummary } from './patient-summary';

/** Google Maps directions (the app on Android, Maps or the browser on iOS); no API key needed. */
export const directionsUrl = (p: { lat: number; lng: number }) => `https://www.google.com/maps/dir/?api=1&destination=${p.lat},${p.lng}&travelmode=driving`;

/**
 * The taken job: where to go, the location-sharing indicator, and one big
 * status button for the next step, the receiving hospital the crew picks
 * (plan §11), and the consented patient summary and first-aid notes (plan §12).
 */
export function JobPanel({ job, tracking }: { job: Schemas['CrewJob']; tracking: boolean | null }) {
  const { t } = useTranslation();
  const { colors, space, radius, tapTarget } = useTheme();
  const advance = useAdvanceJob();
  const [failed, setFailed] = useState(false);
  const { incident, nextStep } = job;

  return (
    <View style={{ gap: space[4] }}>
      {incident.isDrill ? (
        <View style={{ backgroundColor: colors.warningSoft, borderRadius: radius.control, padding: space[3] }}>
          <Text weight="bold" style={{ color: colors.warningText, textAlign: 'center' }}>
            {t('field.drill')}
          </Text>
        </View>
      ) : null}

      <Card style={{ gap: space[2] }}>
        <Text variant="small" tone="muted">
          {t('field.job')}
        </Text>
        <Text variant="h3" accessibilityLiveRegion="polite">
          {t(`field.states.${incident.state}`, { defaultValue: incident.state })}
        </Text>
        {incident.location === null ? <Text tone="muted">{t('field.noLocation')}</Text> : null}
      </Card>

      {tracking !== null ? (
        <View
          accessibilityLiveRegion="polite"
          style={{ flexDirection: 'row', alignItems: 'center', gap: space[2], backgroundColor: tracking ? colors.accentSoft : colors.dangerSoft, borderRadius: radius.control, padding: space[3] }}
        >
          <View style={{ width: space[2], height: space[2], borderRadius: space[1], backgroundColor: tracking ? colors.accentText : colors.dangerText }} />
          <Text variant="small" weight="bold" style={{ color: tracking ? colors.accentText : colors.dangerText, flexShrink: 1 }}>
            {tracking ? t('field.sharingLocation') : t('field.locationOff')}
          </Text>
        </View>
      ) : null}

      {incident.location ? <Button label={t('field.navigate')} tone="neutral" onPress={() => void Linking.openURL(directionsUrl(incident.location!))} /> : null}

      {canPickHospital(job) ? <PatientSummary job={job} /> : null}
      {canPickHospital(job) ? <HospitalPicker job={job} /> : null}
      {canPickHospital(job) && job.handover ? <FirstAidNotes job={job} /> : null}

      {failed ? <Text tone="danger">{t('field.networkError')}</Text> : null}
      {nextStep ? (
        <Button
          label={t(`field.steps.${nextStep}`)}
          disabled={advance.isPending}
          style={{ minHeight: tapTarget + space[5] }}
          onPress={() => {
            setFailed(false);
            advance.mutate({ id: incident.id, to: nextStep }, { onError: (e) => setFailed(!(e instanceof ApiError)) });
          }}
        />
      ) : null}
    </View>
  );
}
