import { router } from 'expo-router';
import { PhoneSignInScreen } from '@repo/mobile';

export default function SignIn() {
  return <PhoneSignInScreen onCodeSent={(phone, channel) => router.push({ pathname: '/verify', params: { phone, channel } })} />;
}
