import { useState } from 'react';
import { View } from 'react-native';
import { useTranslation } from 'react-i18next';
import type { Schemas } from '@repo/api-client';
import { Button, Card, Text, TextField, useTheme } from '@repo/ui-native';
import { ApiError, usePatientSummary, useSaveFirstAidNotes } from '../lib/data';

/**
 * Plan §12: what the person's emergency-sharing consent allows the crew to see
 * (blood group, allergies, conditions, medicines), only during the job. Loaded
 * once per job: every load is a logged view of their health data.
 */
export function PatientSummary({ job }: { job: Schemas['CrewJob'] }) {
  const { t } = useTranslation();
  const { colors, space } = useTheme();
  const summary = usePatientSummary(job.incident.id, true);
  const r = summary.data;

  return (
    <Card style={{ gap: space[2] }}>
      <Text variant="small" tone="muted">
        {t('field.patient.title')}
      </Text>
      {summary.isPending ? <Text tone="muted">{t('field.patient.loading')}</Text> : null}
      {summary.isError ? <Text tone="danger">{t('field.networkError')}</Text> : null}
      {r ? (
        <View style={{ gap: space[2] }}>
          <Text variant="h3">
            {[r.patient.name, r.patient.age !== null ? t('field.patient.age', { age: r.patient.age }) : null].filter(Boolean).join(' · ')}
          </Text>
          <Fact label={t('field.patient.bloodGroup')} value={r.bloodGroup ?? t('field.patient.unknown')} />
          {r.allergies ? (
            <Fact
              label={t('field.patient.allergies')}
              value={r.allergies.length ? r.allergies.map((a) => [a.substance, a.severity ? `(${t(`field.patient.severity.${a.severity}`, { defaultValue: a.severity })})` : null].filter(Boolean).join(' ')).join(', ') : t('field.patient.none')}
              alert={r.allergies.length > 0}
            />
          ) : null}
          {r.conditions ? <Fact label={t('field.patient.conditions')} value={r.conditions.length ? r.conditions.map((c) => c.name).join(', ') : t('field.patient.none')} /> : null}
          {r.medicines ? (
            <Fact
              label={t('field.patient.medicines')}
              value={r.medicines.length ? r.medicines.map((m) => [m.name, m.strength].filter(Boolean).join(' ')).join(', ') : t('field.patient.none')}
            />
          ) : null}
          {r.items.length === 1 ? (
            <Text variant="small" tone="muted">
              {t('field.patient.consentOff')}
            </Text>
          ) : null}
        </View>
      ) : null}
      {r ? <Text style={{ color: colors.textMuted }} variant="caption">{t('field.patient.logged')}</Text> : null}
    </Card>
  );
}

function Fact({ label, value, alert }: { label: string; value: string; alert?: boolean }) {
  return (
    <View>
      <Text variant="small" tone="muted">
        {label}
      </Text>
      <Text weight="bold" tone={alert ? 'danger' : 'default'}>
        {value}
      </Text>
    </View>
  );
}

/** First-aid notes go to the hospital with the handover, so they can be saved once a hospital is chosen. */
export function FirstAidNotes({ job }: { job: Schemas['CrewJob'] }) {
  const { t } = useTranslation();
  const { space } = useTheme();
  const [notes, setNotes] = useState('');
  const save = useSaveFirstAidNotes();

  return (
    <Card style={{ gap: space[3] }}>
      <TextField label={t('field.notes.label')} value={notes} onChangeText={setNotes} multiline maxLength={2000} placeholder={t('field.notes.placeholder')} />
      {save.isSuccess ? <Text tone="accent">{t('field.notes.saved')}</Text> : null}
      {save.isError ? <Text tone="danger">{save.error instanceof ApiError && save.error.status < 500 ? save.error.message : t('field.networkError')}</Text> : null}
      <Button
        label={t('field.notes.save')}
        tone="neutral"
        disabled={!notes.trim() || save.isPending}
        onPress={() => save.mutate({ id: job.incident.id, notes: notes.trim() })}
      />
    </Card>
  );
}
