import { useEffect, useState } from 'react';
import { AccessibilityInfo, Vibration, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { Schemas } from '@repo/api-client';
import { Button, Card, Screen, Text, useTheme } from '@repo/ui-native';
import { ApiError, useAcceptOffer, useDeclineOffer } from '../lib/data';

/** Ring pattern (ms): buzz, pause, repeated until answered. */
const RING = [0, 800, 600];

/**
 * Full-screen incoming job: rings (vibration) until accepted, declined or
 * taken by another crew. Shows where and how far, never medical details.
 */
export function OfferRinging({ offer }: { offer: Schemas['DispatchOffer'] }) {
  const { t } = useTranslation();
  const { colors, space, radius, tapTarget } = useTheme();
  const accept = useAcceptOffer();
  const decline = useDeclineOffer();
  const [notice, setNotice] = useState<string | null>(null);
  const busy = accept.isPending || decline.isPending;

  useEffect(() => {
    Vibration.vibrate(RING, true);
    AccessibilityInfo.announceForAccessibility(t('field.incoming'));
    return () => Vibration.cancel();
  }, [offer.id, t]);

  const onError = (e: Error) => setNotice(e instanceof ApiError && e.status === 409 ? t('field.taken') : t('field.networkError'));

  return (
    <Screen>
      <SafeAreaView style={{ flex: 1, padding: space[5], gap: space[4], justifyContent: 'space-between' }}>
        <View style={{ gap: space[4] }}>
          {offer.isDrill ? (
            <View style={{ backgroundColor: colors.warningSoft, borderRadius: radius.control, padding: space[3] }}>
              <Text weight="bold" style={{ color: colors.warningText, textAlign: 'center' }}>
                {t('field.drill')}
              </Text>
            </View>
          ) : null}
          <View accessibilityRole="header" style={{ backgroundColor: colors.dangerSoft, borderRadius: radius.card, padding: space[5], gap: space[2] }}>
            <Text variant="h2" style={{ color: colors.dangerText }}>
              {t('field.incoming')}
            </Text>
            {offer.distanceM !== null ? <Text variant="bodyLg" weight="bold">{t('field.distance', { km: (offer.distanceM / 1000).toFixed(1) })}</Text> : null}
            {offer.etaS !== null ? <Text tone="muted">{t('field.eta', { min: Math.max(1, Math.round(offer.etaS / 60)) })}</Text> : null}
            {offer.location === null ? <Text tone="muted">{t('field.noLocation')}</Text> : null}
          </View>
          {notice ? (
            <Card>
              <Text accessibilityLiveRegion="assertive">{notice}</Text>
            </Card>
          ) : null}
        </View>

        <View style={{ gap: space[3] }}>
          <Button label={t('field.accept')} disabled={busy} onPress={() => accept.mutate(offer.id, { onError })} style={{ minHeight: tapTarget + space[5] }} />
          <Button label={t('field.decline')} tone="neutral" disabled={busy} onPress={() => decline.mutate(offer.id, { onError })} />
        </View>
      </SafeAreaView>
    </Screen>
  );
}
