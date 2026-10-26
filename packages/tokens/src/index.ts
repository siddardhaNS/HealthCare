import { aurora } from './themes/aurora';
import type { Mode, ResolvedTheme, ServiceKey, Theme } from './types';

export * from './types';

/** Every available theme. Adding a theme = add a file in ./themes and list it here. */
export const themes = { aurora } satisfies Record<string, Theme>;
export type ThemeId = keyof typeof themes;

export const defaultThemeId: ThemeId = 'aurora';
export const defaultMode: Mode = 'dark';

export function resolveTheme(id: ThemeId = defaultThemeId, mode: Mode = defaultMode): ResolvedTheme {
  const { colors, label: _label, ...shared } = themes[id];
  return { ...shared, id, mode, colors: colors[mode] };
}

/** Service colour roles by service key, for tiles, chips and chart series. */
export function serviceColors(theme: ResolvedTheme, service: ServiceKey) {
  const c = theme.colors;
  switch (service) {
    case 'consult':
      return { fg: c.serviceConsult, soft: c.serviceConsultSoft, border: c.serviceConsultBorder };
    case 'pharmacy':
      return { fg: c.servicePharmacy, soft: c.servicePharmacySoft, border: c.servicePharmacyBorder };
    case 'lab':
      return { fg: c.serviceLab, soft: c.serviceLabSoft, border: c.serviceLabBorder };
    case 'companion':
      return { fg: c.serviceCompanion, soft: c.serviceCompanionSoft, border: c.serviceCompanionBorder };
    case 'sos':
      return { fg: c.serviceSos, soft: c.serviceSosSoft, border: c.serviceSosBorder };
  }
}

/** Heatmap ramp, low to high. */
export function heatRamp(theme: ResolvedTheme): [string, string, string, string] {
  const c = theme.colors;
  return [c.heat0, c.heat1, c.heat2, c.heat3];
}
