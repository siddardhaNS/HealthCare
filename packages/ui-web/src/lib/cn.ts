import { clsx, type ClassValue } from 'clsx';
import { extendTailwindMerge } from 'tailwind-merge';
import { themes } from '@repo/tokens';

// Token font sizes (text-body, text-h1...) share the text-* prefix with token
// colours (text-text-muted, text-on-accent); register them as font sizes so
// merging keeps both.
const textSizes = Object.keys(themes.aurora.text).map((k) => k.replace(/[A-Z]/g, (m) => '-' + m.toLowerCase()));
const radii = Object.keys(themes.aurora.radius);

const twMerge = extendTailwindMerge({
  extend: {
    theme: { text: textSizes, radius: radii },
  },
});

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
