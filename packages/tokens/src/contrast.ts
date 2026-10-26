import type { ColorTokens } from './types';

function channel(v: number) {
  const s = v / 255;
  return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
}

export function luminance(hex: string): number {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.replace(/./g, (c) => c + c) : h.slice(0, 6), 16);
  return 0.2126 * channel((n >> 16) & 255) + 0.7152 * channel((n >> 8) & 255) + 0.0722 * channel(n & 255);
}

export function contrastRatio(a: string, b: string): number {
  const [l1, l2] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (l1 + 0.05) / (l2 + 0.05);
}

type Key = keyof ColorTokens;
/** [foreground, background, minimum ratio]. 4.5 = WCAG AA body text, 3 = large text / UI graphics. */
export const contrastPairs: Array<[Key, Key, number]> = [
  ['text', 'bg', 4.5],
  ['text', 'surface', 4.5],
  ['text', 'surfaceRaised', 4.5],
  ['textMuted', 'bg', 4.5],
  ['textMuted', 'surface', 4.5],
  ['onAccent', 'accent', 4.5],
  ['accentText', 'surface', 4.5],
  ['accentText', 'accentSoft', 4.5],
  ['onDanger', 'danger', 4.5],
  ['dangerText', 'dangerSoft', 4.5],
  ['dangerText', 'surface', 4.5],
  ['onWarning', 'warning', 4.5],
  ['warningText', 'warningSoft', 4.5],
  ['warningText', 'surface', 4.5],
  ['onSuccess', 'success', 4.5],
  ['successText', 'successSoft', 4.5],
  ['successText', 'surface', 4.5],
  ['onInfo', 'info', 4.5],
  ['infoText', 'infoSoft', 4.5],
  ['infoText', 'surface', 4.5],
  ['serviceConsult', 'surface', 4.5],
  ['serviceConsult', 'serviceConsultSoft', 4.5],
  ['servicePharmacy', 'surface', 4.5],
  ['servicePharmacy', 'servicePharmacySoft', 4.5],
  ['serviceLab', 'surface', 4.5],
  ['serviceLab', 'serviceLabSoft', 4.5],
  ['serviceCompanion', 'surface', 4.5],
  ['serviceCompanion', 'serviceCompanionSoft', 4.5],
  ['serviceSos', 'surface', 4.5],
  ['serviceSos', 'serviceSosSoft', 4.5],
  ['onService', 'serviceConsult', 4.5],
  ['onService', 'servicePharmacy', 4.5],
  ['onService', 'serviceLab', 4.5],
  ['onService', 'serviceCompanion', 4.5],
  ['onService', 'serviceSos', 3],
  ['mapText', 'mapBg', 4.5],
  ['mapHospital', 'mapBg', 3],
  ['mapAmbulance', 'mapRoad', 3],
];
