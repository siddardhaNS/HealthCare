'use client';

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { defaultThemeId, type Mode, type ThemeId } from '@repo/tokens';

type ModePref = Mode | 'system';

interface ThemeState {
  themeId: ThemeId;
  mode: ModePref;
  setTheme: (id: ThemeId) => void;
  setMode: (mode: ModePref) => void;
}

const ThemeContext = createContext<ThemeState | null>(null);
const STORAGE_KEY = 'ui-theme';

function apply(themeId: ThemeId, mode: ModePref) {
  const el = document.documentElement;
  el.dataset.theme = themeId;
  if (mode === 'system') delete el.dataset.mode;
  else el.dataset.mode = mode;
}

/**
 * The single source of the active theme for both web apps. Colours come from
 * CSS variables (@repo/tokens/theme.css), selected by data-theme/data-mode on
 * <html>; without data-mode the OS preference picks light or dark.
 */
export function ThemeProvider({ initialTheme = defaultThemeId, children }: { initialTheme?: ThemeId; children: ReactNode }) {
  const [themeId, setThemeId] = useState<ThemeId>(initialTheme);
  const [mode, setModeState] = useState<ModePref>('system');

  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null') as { themeId?: ThemeId; mode?: ModePref } | null;
      if (saved?.themeId) setThemeId(saved.themeId);
      if (saved?.mode) setModeState(saved.mode);
    } catch {
      // Storage unavailable: keep defaults.
    }
  }, []);

  useEffect(() => {
    apply(themeId, mode);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ themeId, mode }));
    } catch {
      // Ignore.
    }
  }, [themeId, mode]);

  const setTheme = useCallback((id: ThemeId) => setThemeId(id), []);
  const setMode = useCallback((m: ModePref) => setModeState(m), []);

  return <ThemeContext.Provider value={{ themeId, mode, setTheme, setMode }}>{children}</ThemeContext.Provider>;
}

export function useThemeControls(): ThemeState {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useThemeControls must be used inside <ThemeProvider>');
  return ctx;
}
