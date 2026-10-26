// Web font loading for the Next.js apps. Each face is exposed as the CSS
// variable the generated theme CSS reads (--hc-face-<role>).
import { DM_Sans, JetBrains_Mono, Sora } from 'next/font/google';

const display = Sora({ subsets: ['latin'], weight: ['500', '600', '700'], variable: '--hc-face-display', display: 'swap' });
const body = DM_Sans({ subsets: ['latin'], weight: ['400', '500', '600', '700'], variable: '--hc-face-body', display: 'swap' });
const mono = JetBrains_Mono({ subsets: ['latin'], weight: ['500', '600'], variable: '--hc-face-mono', display: 'swap' });

/** Put on <html> so every theme font variable is defined. */
export const fontVariables = [display.variable, body.variable, mono.variable].join(' ');
