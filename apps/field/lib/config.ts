import { Platform } from 'react-native';
import type { MobileConfig } from '@repo/mobile';

// EXPO_PUBLIC_* values are inlined at build time, so each must be referenced
// literally. Defaults point a dev build at the local stack (the Android
// emulator reaches the host machine on 10.0.2.2).
const host = Platform.OS === 'android' ? '10.0.2.2' : '127.0.0.1';

function required(value: string | undefined, name: string, devDefault: string): string {
  if (value) return value;
  if (__DEV__) return devDefault;
  throw new Error(`${name} is not set for this build`);
}

export const config: MobileConfig = {
  apiUrl: required(process.env.EXPO_PUBLIC_API_URL, 'EXPO_PUBLIC_API_URL', `http://${host}:3001`),
  supabaseUrl: required(process.env.EXPO_PUBLIC_SUPABASE_URL, 'EXPO_PUBLIC_SUPABASE_URL', `http://${host}:54321`),
  supabasePublishableKey: required(process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY, 'EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY', ''),
};
