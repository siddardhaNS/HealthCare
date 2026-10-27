import { iconPaths, type IconName } from '@repo/icons';
import type { ColorValue } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { useTheme } from './theme';

export type { IconName };

export interface IconProps {
  name: IconName;
  size?: number;
  strokeWidth?: number;
  /** Any colour value from the theme (e.g. theme.colors.accentText). Defaults to text. */
  color?: ColorValue;
  /** Accessible name; omit for decorative icons. */
  label?: string;
}

/** Stroke icons from the Aurora design, shared with the web via @repo/icons. */
export function Icon({ name, size = 20, strokeWidth = 1.8, color, label }: IconProps) {
  const t = useTheme();
  return (
    <Svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color ?? t.colors.text}
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      accessible={!!label}
      accessibilityLabel={label}
      importantForAccessibility={label ? 'yes' : 'no-hide-descendants'}
    >
      <Path d={iconPaths[name]} />
    </Svg>
  );
}
