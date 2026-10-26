import { useEffect, useMemo } from 'react';
import * as Sentry from '@sentry/react-native';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useFonts } from 'expo-font';
import { I18nextProvider } from 'react-i18next';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { createI18n } from '@repo/i18n';
import { SessionProvider, useSession } from '@repo/mobile';
import { nativeFonts } from '@repo/tokens/native-fonts';
import { ThemeProvider, useTheme } from '@repo/ui-native';
import { scrubSentryEvent, sentryTracesSampleRate } from '@repo/config/sentry';
import { config } from '../lib/config';

// No-op without EXPO_PUBLIC_SENTRY_DSN. Screenshots, view hierarchy and
// Session Replay stay off: screens show health data.
if (process.env.EXPO_PUBLIC_SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.EXPO_PUBLIC_SENTRY_DSN,
    // RN SDK 8 has no dataCollection option; sendDefaultPii: false governs it.
    sendDefaultPii: false,
    attachScreenshot: false,
    attachViewHierarchy: false,
    tracesSampleRate: sentryTracesSampleRate,
    beforeSend: (event) => scrubSentryEvent(event),
  });
}

void SplashScreen.preventAutoHideAsync();

function Routes({ fontsReady }: { fontsReady: boolean }) {
  const t = useTheme();
  const { session, loading } = useSession();
  const ready = fontsReady && !loading;

  useEffect(() => {
    if (ready) void SplashScreen.hideAsync();
  }, [ready]);

  if (!ready) return null;

  return (
    <>
      <StatusBar style={t.mode === 'dark' ? 'light' : 'dark'} />
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: t.colors.bg } }}>
        <Stack.Protected guard={!!session}>
          <Stack.Screen name="index" />
        </Stack.Protected>
        <Stack.Protected guard={!session}>
          <Stack.Screen name="sign-in" />
          <Stack.Screen name="verify" />
        </Stack.Protected>
      </Stack>
    </>
  );
}

function RootLayout() {
  const [fontsLoaded, fontError] = useFonts(nativeFonts);
  // Language choice moves to onboarding in Phase 2.
  const i18n = useMemo(() => createI18n('en'), []);

  return (
    <SafeAreaProvider>
      <I18nextProvider i18n={i18n}>
        <ThemeProvider>
          <SessionProvider config={config}>
            <Routes fontsReady={fontsLoaded || !!fontError} />
          </SessionProvider>
        </ThemeProvider>
      </I18nextProvider>
    </SafeAreaProvider>
  );
}

export default Sentry.wrap(RootLayout);
