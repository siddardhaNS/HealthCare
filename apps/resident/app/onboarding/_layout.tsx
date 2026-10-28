import { Redirect, Stack, useSegments } from 'expo-router';
import { useTheme } from '@repo/ui-native';
import { useOnboardingStep } from '../../lib/data';

// Onboarding: profile → household → consent → location (for SOS). Always resumes at the first
// unfinished step; when all are done the root layout opens the tabs.
export default function OnboardingLayout() {
  const { colors } = useTheme();
  const { step } = useOnboardingStep();
  const segments = useSegments() as string[];
  const here = segments[1];
  if (step && here !== step) return <Redirect href={`/onboarding/${step}`} />;
  return <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.bg } }} />;
}
