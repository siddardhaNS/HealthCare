import { router, useLocalSearchParams } from 'expo-router';
import { VerifyCodeScreen } from '@repo/mobile';

export default function Verify() {
  const { phone, channel } = useLocalSearchParams<{ phone: string; channel: 'whatsapp' | 'sms' }>();
  return <VerifyCodeScreen phone={phone} channel={channel === 'sms' ? 'sms' : 'whatsapp'} onChangeNumber={() => router.back()} />;
}
