import { describe, expect, it } from 'vitest';
import { contrastPairs, contrastRatio } from '../src/contrast';
import { themes } from '../src/index';
import type { Mode } from '../src/types';

const modes: Mode[] = ['dark', 'light'];

describe('WCAG AA contrast', () => {
  for (const theme of Object.values(themes)) {
    for (const mode of modes) {
      const c = theme.colors[mode];
      for (const [fg, bg, min] of contrastPairs) {
        it(`${theme.id}/${mode}: ${fg} on ${bg} ≥ ${min}`, () => {
          expect(contrastRatio(c[fg], c[bg])).toBeGreaterThanOrEqual(min);
        });
      }
    }
  }
});

describe('token shape', () => {
  it('light and dark define the same roles in every theme', () => {
    for (const t of Object.values(themes)) {
      expect(Object.keys(t.colors.light).sort()).toEqual(Object.keys(t.colors.dark).sort());
    }
  });
});
