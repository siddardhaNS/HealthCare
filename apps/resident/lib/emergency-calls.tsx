import { Linking, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Button, useTheme } from '@repo/ui-native';
import { useDeskPhone } from './sos';

export const dial = (number: string) => void Linking.openURL(`tel:${number}`);

/**
 * Phone fallbacks that work with no network: the community desk (number
 * saved on the phone) and 108. Shown wherever the app cannot reach us, so a
 * person in an emergency is never left with only an error message.
 */
export function EmergencyCalls() {
  const { t } = useTranslation();
  const { space } = useTheme();
  const deskPhone = useDeskPhone();
  return (
    <View style={{ gap: space[3] }}>
      {deskPhone ? <Button label={t('sos.callDesk')} tone="danger" onPress={() => dial(deskPhone)} /> : null}
      <Button label={t('sos.call108')} tone={deskPhone ? 'neutral' : 'danger'} onPress={() => dial('108')} />
    </View>
  );
}
