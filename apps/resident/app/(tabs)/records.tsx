import { useTranslation } from 'react-i18next';
import { Card, Text } from '@repo/ui-native';
import { Page } from '../../lib/ui';

// e-Prescriptions and lab reports arrive with consults and labs (Phases 4–5).
export default function Records() {
  const { t } = useTranslation();
  return (
    <Page>
      <Text variant="h2" accessibilityRole="header">
        {t('tabs.records')}
      </Text>
      <Card>
        <Text tone="muted">{t('common.comingSoon')}</Text>
      </Card>
    </Page>
  );
}
