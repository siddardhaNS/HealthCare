/**
 * Semantic token contract. Components only ever reference these role names;
 * a theme is a file that fills them in for a light and a dark mode.
 */
export type Mode = 'light' | 'dark';

export const serviceKeys = ['consult', 'pharmacy', 'lab', 'companion', 'sos'] as const;
export type ServiceKey = (typeof serviceKeys)[number];

export interface ColorTokens {
  // Surfaces and text
  bg: string;
  surface: string;
  surfaceRaised: string;
  border: string;
  borderStrong: string;
  text: string;
  textMuted: string;
  scrim: string;
  shadow: string;
  /** Behind QR codes and other scannable images: always light, in every theme. */
  qrBackground: string;

  // Brand accent: `accent` is a fill (with `onAccent` on top); `accentText`
  // is safe for text and icons on `surface`.
  accent: string;
  accentSoft: string;
  accentBorder: string;
  accentText: string;
  onAccent: string;

  // Status colours keep the same meaning in every theme.
  danger: string;
  dangerSoft: string;
  dangerBorder: string;
  dangerText: string;
  onDanger: string;
  warning: string;
  warningSoft: string;
  warningBorder: string;
  warningText: string;
  onWarning: string;
  success: string;
  successSoft: string;
  successBorder: string;
  successText: string;
  onSuccess: string;
  info: string;
  infoSoft: string;
  infoBorder: string;
  infoText: string;
  onInfo: string;

  // Service colours: same role per service in every theme. `serviceX` is
  // safe for text/icons on `surface` and as a fill under `onService`.
  serviceConsult: string;
  serviceConsultSoft: string;
  serviceConsultBorder: string;
  servicePharmacy: string;
  servicePharmacySoft: string;
  servicePharmacyBorder: string;
  serviceLab: string;
  serviceLabSoft: string;
  serviceLabBorder: string;
  serviceCompanion: string;
  serviceCompanionSoft: string;
  serviceCompanionBorder: string;
  serviceSos: string;
  serviceSosSoft: string;
  serviceSosBorder: string;
  onService: string;

  // Maps (native map style and web map style are generated from these)
  mapBg: string;
  mapBlock: string;
  mapPark: string;
  mapParkLine: string;
  mapRoad: string;
  mapWater: string;
  mapLabel: string;
  mapText: string;
  mapHospital: string;
  mapAmbulance: string;
  mapAmbulanceOff: string;

  // Heatmap colour ramp, low to high
  heat0: string;
  heat1: string;
  heat2: string;
  heat3: string;
}

export interface FontRole {
  /** CSS font-family stack for web. */
  css: string;
  /** Font keys registered with expo-font, by weight. */
  native: { regular: string; medium: string; semibold: string; bold: string };
}

export interface ThemeShared {
  fonts: { display: FontRole; body: FontRole; mono: FontRole };
  /** px. Semantic radii; the Aurora look is 22–26 px on large containers. */
  radius: { xs: number; sm: number; control: number; md: number; panel: number; card: number; section: number; pill: number };
  /** px, 4-based spacing scale. */
  space: { 0: number; 1: number; 2: number; 3: number; 4: number; 5: number; 6: number; 8: number; 10: number; 12: number; 16: number };
  /** px font sizes and line heights. */
  text: Record<'caption' | 'small' | 'body' | 'bodyLg' | 'title' | 'h3' | 'h2' | 'h1' | 'display' | 'hero', { size: number; line: number }>;
  /** Minimum tap target in px. */
  tapTarget: number;
}

export interface Theme extends ThemeShared {
  id: string;
  label: string;
  colors: Record<Mode, ColorTokens>;
}

export interface ResolvedTheme extends ThemeShared {
  id: string;
  mode: Mode;
  colors: ColorTokens;
}
