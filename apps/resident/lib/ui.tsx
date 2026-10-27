import { useEffect, useState, type ReactNode } from 'react';
import { ActivityIndicator, Keyboard, Modal, Platform, Pressable, RefreshControl, View, type ViewStyle } from 'react-native';
import { useTranslation } from 'react-i18next';
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button, Icon, Screen, Text, useTheme } from '@repo/ui-native';

/** Screen scaffold: safe area, scroll with pull-to-refresh, design spacing. */
export function Page({ children, refreshing, onRefresh }: { children: ReactNode; refreshing?: boolean; onRefresh?: () => void }) {
  const { space, colors } = useTheme();
  return (
    <Screen>
      <SafeAreaView style={{ flex: 1 }} edges={['top']}>
        {/* Scrolls the focused field above the keyboard (Android edge-to-edge no longer resizes the window). */}
        <KeyboardAwareScrollView
          bottomOffset={space[6]}
          contentContainerStyle={{ paddingHorizontal: space[5], paddingTop: space[6], paddingBottom: space[8], gap: space[3] + 2 }}
          refreshControl={onRefresh ? <RefreshControl refreshing={!!refreshing} onRefresh={onRefresh} tintColor={colors.accent} /> : undefined}
          keyboardShouldPersistTaps="handled"
        >
          {children}
        </KeyboardAwareScrollView>
      </SafeAreaView>
    </Screen>
  );
}

export function SectionLabel({ children }: { children: string }) {
  const { space } = useTheme();
  return (
    <Text variant="label" tone="muted" style={{ marginTop: space[2] }} accessibilityRole="header">
      {children}
    </Text>
  );
}

/** Status pill using the status tokens (meaning is the same in every theme). */
export function StatusChip({ level, label }: { level: 'ok' | 'warn' | 'danger' | 'neutral'; label: string }) {
  const { colors, radius, space } = useTheme();
  const c = {
    ok: [colors.successSoft, colors.successText],
    warn: [colors.warningSoft, colors.warningText],
    danger: [colors.dangerSoft, colors.dangerText],
    neutral: [colors.surfaceRaised, colors.textMuted],
  }[level];
  return (
    <View style={{ alignSelf: 'flex-start', backgroundColor: c[0], borderRadius: radius.pill, paddingHorizontal: space[2] + 2, paddingVertical: 2 }}>
      <Text variant="caption" weight="bold" style={{ color: c[1] }}>
        {label}
      </Text>
    </View>
  );
}

export function Loading() {
  const { colors, space } = useTheme();
  const { t } = useTranslation();
  return (
    <View style={{ padding: space[8], alignItems: 'center' }} accessibilityLabel={t('common.loading')}>
      <ActivityIndicator color={colors.accent} />
    </View>
  );
}

export function ErrorState({ onRetry }: { onRetry: () => void }) {
  const { t } = useTranslation();
  const { space } = useTheme();
  return (
    <View style={{ gap: space[3], paddingVertical: space[4] }} accessibilityRole="alert">
      <Text tone="danger">{t('common.error')}</Text>
      <Button label={t('common.retry')} tone="neutral" onPress={onRetry} />
    </View>
  );
}

/** Bottom sheet dialog (the design's "Log a reading" sheet). */
export function Sheet({ visible, title, onClose, children }: { visible: boolean; title: string; onClose: () => void; children: ReactNode }) {
  const { colors, radius, space } = useTheme();
  const { t } = useTranslation();
  const keyboard = useKeyboardHeight();
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      {/* Lift the sheet above the keyboard. KeyboardAvoidingView cannot do this in an Android modal (edge-to-edge). */}
      <View style={{ flex: 1, paddingBottom: keyboard }}>
        <Pressable style={{ flex: 1, backgroundColor: colors.scrim }} onPress={onClose} accessibilityLabel={t('healthTab.close')} />
        <View
          accessibilityViewIsModal
          style={{
            backgroundColor: colors.surface,
            borderTopLeftRadius: radius.section,
            borderTopRightRadius: radius.section,
            padding: space[5],
            paddingBottom: space[10],
            gap: space[4],
          }}
        >
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <Text variant="h3" accessibilityRole="header">
              {title}
            </Text>
            <IconButton icon="close" label={t('healthTab.close')} onPress={onClose} />
          </View>
          {children}
        </View>
      </View>
    </Modal>
  );
}

function useKeyboardHeight() {
  const [height, setHeight] = useState(0);
  useEffect(() => {
    const ios = Platform.OS === 'ios';
    const show = Keyboard.addListener(ios ? 'keyboardWillShow' : 'keyboardDidShow', (e) => setHeight(e.endCoordinates.height));
    const hide = Keyboard.addListener(ios ? 'keyboardWillHide' : 'keyboardDidHide', () => setHeight(0));
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);
  return height;
}

export function IconButton({
  icon,
  label,
  onPress,
  color,
  style,
}: {
  icon: Parameters<typeof Icon>[0]['name'];
  label: string;
  onPress: () => void;
  color?: string;
  style?: ViewStyle;
}) {
  const { tapTarget } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      hitSlop={8}
      style={[{ minWidth: tapTarget, minHeight: tapTarget, alignItems: 'center', justifyContent: 'center' }, style]}
    >
      <Icon name={icon} color={color} />
    </Pressable>
  );
}

/** Two-to-four option pill row (radio semantics), e.g. vital type or severity. */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  label,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
  label: string;
}) {
  const { colors, radius, space, tapTarget } = useTheme();
  return (
    <View accessibilityRole="radiogroup" accessibilityLabel={label} style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space[2] }}>
      {options.map((o) => {
        const on = o.value === value;
        return (
          <Pressable
            key={o.value}
            accessibilityRole="radio"
            accessibilityState={{ selected: on }}
            onPress={() => onChange(o.value)}
            style={{
              minHeight: tapTarget,
              paddingHorizontal: space[4],
              justifyContent: 'center',
              borderRadius: radius.pill,
              borderWidth: 1,
              borderColor: on ? colors.accentBorder : colors.border,
              backgroundColor: on ? colors.accentSoft : colors.surface,
            }}
          >
            <Text variant="small" weight="bold" tone={on ? 'accent' : 'default'}>
              {o.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}
