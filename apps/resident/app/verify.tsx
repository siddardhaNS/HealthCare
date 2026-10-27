import { Redirect, router, useLocalSearchParams } from 'expo-router';
import { VerifyCodeScreen } from '@repo/mobile';

export default function Verify() {
  const { phone, channel } = useLocalSearchParams<{ phone?: string; channel?: 'whatsapp' | 'sms' }>();
  // Opened without a number (e.g. as the first signed-out screen on launch): start at sign-in.
  if (!phone) return <Redirect href="/sign-in" />;
  return <VerifyCodeScreen phone={phone} channel={channel === 'sms' ? 'sms' : 'whatsapp'} onChangeNumber={() => router.back()} />;
}
