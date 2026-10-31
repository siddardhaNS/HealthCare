import { useState } from 'react';
import { Linking, Pressable } from 'react-native';
import { useTranslation } from 'react-i18next';
import type { Schemas } from '@repo/api-client';
import { Button, Card, Text, TextField, useTheme } from '@repo/ui-native';
import { ApiError, useJobHospitals, usePickHospital } from '../lib/data';

/**
 * Plan §11: the crew picks the receiving hospital after accepting. Nothing is
 * chosen automatically; the pick opens the handover. Changing it later needs a
 * reason, and the old handover link stops working.
 */
export function HospitalPicker({ job }: { job: Schemas['CrewJob'] }) {
  const { t } = useTranslation();
  const { colors, space, radius, tapTarget } = useTheme();
  const { incident, handover } = job;
  const [changing, setChanging] = useState(false);
  const [reason, setReason] = useState('');
  const open = !handover || changing;
  const hospitals = useJobHospitals(incident.id, open);
  const pick = usePickHospital();
  const needsReason = !!handover;

  const choose = (hospitalId: string) =>
    pick.mutate(
      { id: incident.id, hospitalId, ...(needsReason ? { reason: reason.trim() } : {}) },
      {
        onSuccess: () => {
          setChanging(false);
          setReason('');
        },
      },
    );

  if (handover && !changing) {
    return (
      <Card style={{ gap: space[2] }}>
        <Text variant="small" tone="muted">
          {t('field.hospital.title')}
        </Text>
        <Text variant="h3">{handover.hospital.name}</Text>
        <Text variant="small" tone="muted">
          {handover.confirmedAt ? t('field.hospital.confirmed') : t('field.hospital.sent')}
        </Text>
        <Button label={t('field.hospital.callEr')} tone="neutral" onPress={() => void Linking.openURL(`tel:${handover.hospital.erPhone}`)} />
        <Button label={t('field.hospital.change')} tone="neutral" onPress={() => setChanging(true)} />
      </Card>
    );
  }

  return (
    <Card style={{ gap: space[3] }}>
      <Text variant="h3">{handover ? t('field.hospital.changeTitle') : t('field.hospital.choose')}</Text>
      <Text variant="small" tone="muted">
        {t('field.hospital.hint')}
      </Text>
      {needsReason ? <TextField label={t('field.hospital.reason')} value={reason} onChangeText={setReason} maxLength={200} /> : null}
      {hospitals.isPending ? <Text tone="muted">{t('field.hospital.loading')}</Text> : null}
      {hospitals.isError ? <Text tone="danger">{t('field.networkError')}</Text> : null}
      {hospitals.data?.length === 0 ? <Text tone="muted">{t('field.hospital.none')}</Text> : null}
      {hospitals.data
        ?.filter((h) => h.id !== handover?.hospital.id)
        .map((h) => {
          const disabled = pick.isPending || (needsReason && !reason.trim());
          const facts = [
            h.etaS !== null ? t('field.eta', { min: Math.max(1, Math.round(h.etaS / 60)) }) : null,
            h.hasCapacity ? null : t('field.hospital.erFull'),
            h.preferred ? t('field.hospital.preferred') : null,
          ].filter(Boolean);
          return (
            <Pressable
              key={h.id}
              accessibilityRole="button"
              accessibilityState={{ disabled }}
              accessibilityLabel={[h.name, ...facts].join(', ')}
              disabled={disabled}
              onPress={() => choose(h.id)}
              style={{
                minHeight: tapTarget + space[3],
                justifyContent: 'center',
                gap: space[1],
                padding: space[3],
                borderRadius: radius.control,
                borderWidth: 1,
                borderColor: h.hasCapacity ? colors.borderStrong : colors.warningText,
                opacity: disabled ? 0.6 : 1,
              }}
            >
              <Text weight="bold">{h.name}</Text>
              {facts.length ? (
                <Text variant="small" tone="muted">
                  {facts.join(' · ')}
                </Text>
              ) : null}
            </Pressable>
          );
        })}
      {pick.isError ? <Text tone="danger">{pick.error instanceof ApiError && pick.error.status < 500 ? pick.error.message : t('field.networkError')}</Text> : null}
      {handover ? (
        <Button
          label={t('field.hospital.keep')}
          tone="neutral"
          onPress={() => {
            setChanging(false);
            setReason('');
          }}
        />
      ) : null}
    </Card>
  );
}

/** Shown only while the crew can still send the patient somewhere, and never for drills. */
export const canPickHospital = (job: Schemas['CrewJob']) => !job.incident.isDrill && ['accepted', 'en_route', 'on_scene', 'transporting'].includes(job.incident.state);

