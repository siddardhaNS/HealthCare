import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { useColorScheme } from 'react-native';
import { defaultThemeId, resolveTheme, type Mode, type ResolvedTheme, type ThemeId } from '@repo/tokens';

const ThemeContext = createContext<ResolvedTheme | null>(null);

export interface ThemeProviderProps {
  themeId?: ThemeId;
  /** Force a mode; omitted = follow the OS setting. */
  mode?: Mode;
  children: ReactNode;
}

/** The single source of the active theme for every native component. */
export function ThemeProvider({ themeId = defaultThemeId, mode, children }: ThemeProviderProps) {
  const system = useColorScheme();
  const resolvedMode: Mode = mode ?? (system === 'light' ? 'light' : 'dark');
  const theme = useMemo(() => resolveTheme(themeId, resolvedMode), [themeId, resolvedMode]);
  return <ThemeContext.Provider value={theme}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ResolvedTheme {
  const theme = useContext(ThemeContext);
  if (!theme) throw new Error('useTheme must be used inside <ThemeProvider>');
  return theme;
}
