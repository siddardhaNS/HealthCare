import { useEffect, useMemo } from 'react';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useFonts } from 'expo-font';
import { I18nextProvider } from 'react-i18next';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { createI18n } from '@repo/i18n';
import { nativeFonts } from '@repo/tokens/native-fonts';
import { ThemeProvider, useTheme } from '@repo/ui-native';

void SplashScreen.preventAutoHideAsync();

function ThemedStack() {
  const t = useTheme();
  return (
    <>
      <StatusBar style={t.mode === 'dark' ? 'light' : 'dark'} />
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: t.colors.bg } }} />
    </>
  );
}

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts(nativeFonts);
  // Language choice moves to onboarding in Phase 2.
  const i18n = useMemo(() => createI18n('en'), []);

  useEffect(() => {
    if (fontsLoaded || fontError) void SplashScreen.hideAsync();
  }, [fontsLoaded, fontError]);

  if (!fontsLoaded && !fontError) return null;

  return (
    <SafeAreaProvider>
      <I18nextProvider i18n={i18n}>
        <ThemeProvider>
          <ThemedStack />
        </ThemeProvider>
      </I18nextProvider>
    </SafeAreaProvider>
  );
}
