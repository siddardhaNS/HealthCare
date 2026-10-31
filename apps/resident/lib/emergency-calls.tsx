import { Linking, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Button, Text, useTheme } from '@repo/ui-native';
import { useDeskPhone } from './sos';

export const dial = (number: string) => void Linking.openURL(`tel:${number}`);

/**
 * The phone fallback that works with no network (plan §11): the community
 * desk, on the number set in the console and saved on the phone. Shown
 * wherever the app cannot reach us. No 108 button.
 */
export function EmergencyCalls() {
  const { t } = useTranslation();
  const { space } = useTheme();
  const deskPhone = useDeskPhone();
  return (
    <View style={{ gap: space[3] }}>
      {deskPhone ? (
        <Button label={t('sos.callDesk')} tone="danger" onPress={() => dial(deskPhone)} testID="call-desk" />
      ) : (
        <Text variant="small" tone="muted">
          {t('sos.noDeskNumber')}
        </Text>
      )}
    </View>
  );
}
