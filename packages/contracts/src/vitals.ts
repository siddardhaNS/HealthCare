// Vital signs: units, accepted ranges, target bands and status, shared by the
// API, console and apps (dependency-free). Ranges match the database checks
// in supabase/migrations/*_health_record.sql; statuses follow the design's
// statusOf() rules. Clinical thresholds need sign-off from the medical lead.

export const vitalTypes = ['bp', 'pulse', 'spo2', 'sugar', 'temp', 'weight'] as const;
export type VitalType = (typeof vitalTypes)[number];

export const vitalUnits: Record<VitalType, string> = { bp: 'mmHg', pulse: 'bpm', spo2: '%', sugar: 'mg/dL', temp: '°F', weight: 'kg' };

/** Values outside these are rejected as entry mistakes (bp: [systolic, diastolic]). */
export const vitalLimits: Record<VitalType, { min: number; max: number; min2?: number; max2?: number }> = {
  bp: { min: 60, max: 250, min2: 30, max2: 150 },
  pulse: { min: 30, max: 220 },
  spo2: { min: 50, max: 100 },
  sugar: { min: 20, max: 600 },
  temp: { min: 90, max: 110 },
  weight: { min: 20, max: 250 },
};

/** Target band drawn behind trend charts ([low, high]; bp uses systolic). */
export const vitalTargets: Record<VitalType, { low: number; high: number } | null> = {
  bp: { low: 90, high: 130 },
  pulse: { low: 60, high: 100 },
  spo2: { low: 95, high: 100 },
  sugar: { low: 80, high: 130 },
  temp: { low: 97, high: 99.5 },
  weight: null,
};

export type VitalLevel = 'ok' | 'warn' | 'danger';
export type VitalStatusKey =
  | 'normal'
  | 'elevated'
  | 'high'
  | 'crisis'
  | 'low'
  | 'outside_range'
  | 'abnormal'
  | 'below_normal'
  | 'in_target'
  | 'above_target'
  | 'fever'
  | 'slightly_high'
  | 'underweight'
  | 'healthy_bmi'
  | 'overweight'
  | 'obese'
  | 'unknown';

export interface VitalStatus {
  key: VitalStatusKey;
  level: VitalLevel;
}

const s = (key: VitalStatusKey, level: VitalLevel): VitalStatus => ({ key, level });

export function bmi(weightKg: number, heightCm: number): number {
  return Math.round((weightKg / Math.pow(heightCm / 100, 2)) * 10) / 10;
}

/** Status of one reading. Weight needs the height to judge (BMI). */
export function vitalStatus(type: VitalType, value: number, value2?: number | null, heightCm?: number | null): VitalStatus {
  switch (type) {
    case 'bp': {
      const a = value;
      const b = value2 ?? 0;
      if (a >= 180 || b >= 120) return s('crisis', 'danger');
      if (a >= 140 || b >= 90) return s('high', 'danger');
      if (a >= 130 || b >= 80) return s('elevated', 'warn');
      if (a < 90 || b < 60) return s('low', 'warn');
      return s('normal', 'ok');
    }
    case 'pulse':
      if (value < 50 || value > 120) return s('abnormal', 'danger');
      if (value < 60 || value > 100) return s('outside_range', 'warn');
      return s('normal', 'ok');
    case 'spo2':
      if (value < 92) return s('low', 'danger');
      if (value < 95) return s('below_normal', 'warn');
      return s('normal', 'ok');
    case 'sugar':
      if (value < 70) return s('low', 'danger');
      if (value > 180) return s('high', 'danger');
      if (value > 130) return s('above_target', 'warn');
      return s('in_target', 'ok');
    case 'temp':
      if (value >= 100.4) return s('fever', 'danger');
      if (value > 99.5) return s('slightly_high', 'warn');
      if (value < 96.5) return s('low', 'warn');
      return s('normal', 'ok');
    case 'weight': {
      if (!heightCm) return s('unknown', 'ok');
      const b = bmi(value, heightCm);
      if (b < 18.5) return s('underweight', 'warn');
      if (b < 25) return s('healthy_bmi', 'ok');
      if (b < 30) return s('overweight', 'warn');
      return s('obese', 'danger');
    }
  }
}

/** Returns an error key if the reading is impossible (a typing mistake), else null. */
export function checkVital(type: VitalType, value: number, value2?: number | null): 'out_of_range' | 'needs_diastolic' | 'unexpected_second_value' | null {
  const l = vitalLimits[type];
  if (type === 'bp') {
    if (value2 == null) return 'needs_diastolic';
    if (value2 < l.min2! || value2 > l.max2! || value2 >= value) return 'out_of_range';
  } else if (value2 != null) return 'unexpected_second_value';
  return value < l.min || value > l.max ? 'out_of_range' : null;
}
