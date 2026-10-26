import type { ReactNode } from 'react';
import { Pressable, Text as RNText, View, type PressableProps, type StyleProp, type TextProps as RNTextProps, type TextStyle, type ViewProps } from 'react-native';
import { serviceColors, type ResolvedTheme, type ServiceKey } from '@repo/tokens';
import { useTheme } from './theme';

type TextVariant = 'hero' | 'display' | 'h1' | 'h2' | 'h3' | 'title' | 'bodyLg' | 'body' | 'small' | 'caption' | 'label';
type TextTone = 'default' | 'muted' | 'accent' | 'danger' | 'onAccent' | 'onDanger';

function textStyle(t: ResolvedTheme, variant: TextVariant, tone: TextTone): TextStyle {
  const color = {
    default: t.colors.text,
    muted: t.colors.textMuted,
    accent: t.colors.accentText,
    danger: t.colors.dangerText,
    onAccent: t.colors.onAccent,
    onDanger: t.colors.onDanger,
  }[tone];
  if (variant === 'label') {
    return { color, fontFamily: t.fonts.body.native.bold, fontSize: t.text.caption.size, lineHeight: t.text.caption.line, letterSpacing: 0.96, textTransform: 'uppercase' };
  }
  const isDisplay = ['hero', 'display', 'h1', 'h2', 'h3', 'title'].includes(variant);
  const size = t.text[variant];
  return {
    color,
    fontFamily: isDisplay ? t.fonts.display.native.bold : t.fonts.body.native.regular,
    fontSize: size.size,
    lineHeight: size.line,
  };
}

export interface TextProps extends RNTextProps {
  variant?: TextVariant;
  tone?: TextTone;
  weight?: 'regular' | 'medium' | 'semibold' | 'bold';
}

export function Text({ variant = 'body', tone = 'default', weight, style, ...rest }: TextProps) {
  const t = useTheme();
  const base = textStyle(t, variant, tone);
  const weighted: StyleProp<TextStyle> = weight ? { fontFamily: (base.fontFamily === t.fonts.body.native.regular ? t.fonts.body : t.fonts.display).native[weight] } : null;
  return <RNText style={[base, weighted, style]} maxFontSizeMultiplier={1.6} {...rest} />;
}

export function Screen({ style, ...rest }: ViewProps) {
  const t = useTheme();
  return <View style={[{ flex: 1, backgroundColor: t.colors.bg }, style]} {...rest} />;
}

export function Card({ style, ...rest }: ViewProps) {
  const t = useTheme();
  return (
    <View
      style={[{ backgroundColor: t.colors.surface, borderColor: t.colors.border, borderWidth: 1, borderRadius: t.radius.card, padding: t.space[4] }, style]}
      {...rest}
    />
  );
}

export interface ButtonProps extends Omit<PressableProps, 'children'> {
  label: string;
  tone?: 'accent' | 'danger' | 'neutral';
}

export function Button({ label, tone = 'accent', style, ...rest }: ButtonProps) {
  const t = useTheme();
  const bg = { accent: t.colors.accent, danger: t.colors.danger, neutral: t.colors.surfaceRaised }[tone];
  const fg = { accent: 'onAccent', danger: 'onDanger', neutral: 'default' }[tone] as TextTone;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      style={(state) => [
        { minHeight: t.tapTarget, paddingHorizontal: t.space[5], borderRadius: t.radius.control, backgroundColor: bg, alignItems: 'center', justifyContent: 'center', opacity: state.pressed ? 0.85 : 1 },
        typeof style === 'function' ? style(state) : style,
      ]}
      {...rest}
    >
      <Text variant="body" weight="bold" tone={fg}>
        {label}
      </Text>
    </Pressable>
  );
}

export interface ServiceTileProps extends Omit<PressableProps, 'children'> {
  service: ServiceKey;
  title: string;
  subtitle: string;
  icon?: ReactNode;
}

/** Care-service tile from the home screen; colours come from the service role. */
export function ServiceTile({ service, title, subtitle, icon, style, ...rest }: ServiceTileProps) {
  const t = useTheme();
  const c = serviceColors(t, service);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${title}. ${subtitle}`}
      style={(state) => [
        { backgroundColor: t.colors.surface, borderColor: t.colors.border, borderWidth: 1, borderRadius: t.radius.card, padding: t.space[3] + 2, gap: t.space[2] + 2, minHeight: t.tapTarget, opacity: state.pressed ? 0.85 : 1 },
        typeof style === 'function' ? style(state) : style,
      ]}
      {...rest}
    >
      <View style={{ width: 40, height: 40, borderRadius: t.radius.sm, backgroundColor: c.soft, borderColor: c.border, borderWidth: 1, alignItems: 'center', justifyContent: 'center' }}>
        {icon ?? <View style={{ width: 12, height: 12, borderRadius: t.radius.pill, backgroundColor: c.fg }} />}
      </View>
      <Text variant="body" weight="bold">
        {title}
      </Text>
      <Text variant="small" tone="muted">
        {subtitle}
      </Text>
    </Pressable>
  );
}
