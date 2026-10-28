import { useEffect, useMemo } from 'react';
import * as Sentry from '@sentry/react-native';
import { QueryClientProvider } from '@tanstack/react-query';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useFonts } from 'expo-font';
import { I18nextProvider, useTranslation } from 'react-i18next';
import { KeyboardProvider } from 'react-native-keyboard-controller';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { createI18n } from '@repo/i18n';
import { SessionProvider, useSession } from '@repo/mobile';
import { nativeFonts } from '@repo/tokens/native-fonts';
import { Screen, ThemeProvider, useTheme } from '@repo/ui-native';
import { scrubSentryEvent, sentryTracesSampleRate } from '@repo/config/sentry';
import { config } from '../lib/config';
import { queryClient, useOnboardingStep, useProfile } from '../lib/data';
import { EmergencyCalls } from '../lib/emergency-calls';
import { ErrorState } from '../lib/ui';

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
  const onboarding = useOnboardingStep();
  const { i18n } = useTranslation();
  const language = useProfile().data?.language;
  // Speak the person's chosen language everywhere once their profile has it.
  useEffect(() => {
    if (language && i18n.language !== language) void i18n.changeLanguage(language);
  }, [language, i18n]);
  const ready = fontsReady && !loading && !onboarding.loading;

  useEffect(() => {
    if (ready) void SplashScreen.hideAsync();
  }, [ready]);

  if (!ready) return null;
  if (onboarding.error) {
    return (
      <Screen style={{ justifyContent: 'center', padding: t.space[5], gap: t.space[6] }}>
        <ErrorState onRetry={onboarding.retry} />
        {/* Offline or the service is down: the emergency numbers must still be one tap away. */}
        <EmergencyCalls />
      </Screen>
    );
  }

  const signedIn = !!session;
  return (
    <>
      <StatusBar style={t.mode === 'dark' ? 'light' : 'dark'} />
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: t.colors.bg } }}>
        <Stack.Protected guard={signedIn && !onboarding.step}>
          <Stack.Screen name="(tabs)" />
          {/* No swipe-to-dismiss: leaving is a deliberate tap (minimise, cancel or done). */}
          <Stack.Screen name="sos" options={{ presentation: 'fullScreenModal', gestureEnabled: false, animation: 'fade' }} />
        </Stack.Protected>
        <Stack.Protected guard={signedIn && !!onboarding.step}>
          <Stack.Screen name="onboarding" />
        </Stack.Protected>
        <Stack.Protected guard={!signedIn}>
          <Stack.Screen name="sign-in" />
          <Stack.Screen name="verify" />
        </Stack.Protected>
      </Stack>
    </>
  );
}

function RootLayout() {
  const [fontsLoaded, fontError] = useFonts(nativeFonts);
  // The chosen language is applied from the profile once onboarding saves it.
  const i18n = useMemo(() => createI18n('en'), []);

  return (
    <SafeAreaProvider>
      <KeyboardProvider>
        <I18nextProvider i18n={i18n}>
          <ThemeProvider>
            <QueryClientProvider client={queryClient}>
              <SessionProvider config={config}>
                <Routes fontsReady={fontsLoaded || !!fontError} />
              </SessionProvider>
            </QueryClientProvider>
          </ThemeProvider>
        </I18nextProvider>
      </KeyboardProvider>
    </SafeAreaProvider>
  );
}

export default Sentry.wrap(RootLayout);
