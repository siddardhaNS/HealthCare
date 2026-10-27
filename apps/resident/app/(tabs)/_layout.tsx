import { Tabs } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Icon, useTheme, type IconName } from '@repo/ui-native';

const tabs: { name: string; title: string; icon: IconName }[] = [
  { name: 'index', title: 'tabs.home', icon: 'home' },
  { name: 'health', title: 'tabs.health', icon: 'heart' },
  { name: 'bookings', title: 'tabs.bookings', icon: 'calendar' },
  { name: 'records', title: 'tabs.records', icon: 'folder' },
  { name: 'profile', title: 'tabs.profile', icon: 'user' },
];

// The design's five-tab bar (Home, Health, Bookings, Records, Profile).
export default function TabsLayout() {
  const { t } = useTranslation();
  const theme = useTheme();
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: theme.colors.accentText,
        tabBarInactiveTintColor: theme.colors.textMuted,
        tabBarStyle: { backgroundColor: theme.colors.surfaceRaised, borderTopColor: theme.colors.border, height: 72, paddingTop: theme.space[2] },
        tabBarLabelStyle: { fontFamily: theme.fonts.body.native.semibold, fontSize: theme.text.caption.size },
        sceneStyle: { backgroundColor: theme.colors.bg },
      }}
    >
      {tabs.map((tab) => (
        <Tabs.Screen key={tab.name} name={tab.name} options={{ title: t(tab.title), tabBarIcon: ({ color }) => <Icon name={tab.icon} color={color} size={22} /> }} />
      ))}
    </Tabs>
  );
}
