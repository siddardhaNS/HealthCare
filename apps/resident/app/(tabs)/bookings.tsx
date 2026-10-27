import { useTranslation } from 'react-i18next';
import { Card, Text } from '@repo/ui-native';
import { Page } from '../../lib/ui';

// Consults, medicine orders, lab visits and companion trips arrive in Phases 4–5.
export default function Bookings() {
  const { t } = useTranslation();
  return (
    <Page>
      <Text variant="h2" accessibilityRole="header">
        {t('tabs.bookings')}
      </Text>
      <Card>
        <Text tone="muted">{t('common.comingSoon')}</Text>
      </Card>
    </Page>
  );
}
