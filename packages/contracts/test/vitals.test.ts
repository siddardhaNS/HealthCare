import { describe, expect, it } from 'vitest';
import { bmi, checkVital, vitalStatus } from '../src/vitals';

describe('vital status (design rules)', () => {
  it.each([
    ['bp', 120, 78, 'normal', 'ok'],
    ['bp', 132, 82, 'elevated', 'warn'],
    ['bp', 145, 88, 'high', 'danger'],
    ['bp', 128, 92, 'high', 'danger'],
    ['bp', 182, 100, 'crisis', 'danger'],
    ['bp', 85, 55, 'low', 'warn'],
    ['pulse', 74, null, 'normal', 'ok'],
    ['pulse', 105, null, 'outside_range', 'warn'],
    ['pulse', 130, null, 'abnormal', 'danger'],
    ['spo2', 97, null, 'normal', 'ok'],
    ['spo2', 93, null, 'below_normal', 'warn'],
    ['spo2', 90, null, 'low', 'danger'],
    ['sugar', 110, null, 'in_target', 'ok'],
    ['sugar', 150, null, 'above_target', 'warn'],
    ['sugar', 190, null, 'high', 'danger'],
    ['sugar', 65, null, 'low', 'danger'],
    ['temp', 98.4, null, 'normal', 'ok'],
    ['temp', 99.8, null, 'slightly_high', 'warn'],
    ['temp', 101, null, 'fever', 'danger'],
  ] as const)('%s %s/%s → %s', (type, v, v2, key, level) => {
    expect(vitalStatus(type, v, v2)).toEqual({ key, level });
  });

  it('judges weight by BMI and needs the height', () => {
    expect(bmi(70, 175)).toBe(22.9);
    expect(vitalStatus('weight', 70, null, 175)).toEqual({ key: 'healthy_bmi', level: 'ok' });
    expect(vitalStatus('weight', 95, null, 165)).toEqual({ key: 'obese', level: 'danger' });
    expect(vitalStatus('weight', 70, null, null).key).toBe('unknown');
  });

  it('rejects impossible readings (entry mistakes)', () => {
    expect(checkVital('bp', 120, 80)).toBeNull();
    expect(checkVital('bp', 120, null)).toBe('needs_diastolic');
    expect(checkVital('bp', 80, 120)).toBe('out_of_range');
    expect(checkVital('spo2', 101)).toBe('out_of_range');
    expect(checkVital('pulse', 70, 10)).toBe('unexpected_second_value');
  });
});
