import type { SVGProps } from 'react';
import { iconPaths as paths, type IconName } from '@repo/icons';

export type { IconName };

/** Stroke icons from the Aurora design. Colour follows currentColor. */
export interface IconProps extends Omit<SVGProps<SVGSVGElement>, 'name'> {
  name: IconName;
  size?: number;
  strokeWidth?: number;
  /** Accessible name; omit for decorative icons (hidden from screen readers). */
  label?: string;
}

export function Icon({ name, size = 20, strokeWidth = 1.8, label, ...rest }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      focusable="false"
      {...rest}
    >
      <path d={paths[name]} />
    </svg>
  );
}
