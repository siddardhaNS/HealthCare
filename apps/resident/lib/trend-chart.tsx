import Svg, { Circle, Polyline, Rect } from 'react-native-svg';
import { useTheme } from '@repo/ui-native';

const W = 320;
const H = 130;
const PAD = 12;

/**
 * The design's 7-reading trend: target band shaded, line through the
 * readings (oldest → newest), points coloured by status. bp plots systolic.
 */
export function TrendChart({ values, levels, target, label }: { values: number[]; levels: ('ok' | 'warn' | 'danger')[]; target: { low: number; high: number } | null; label: string }) {
  const { colors } = useTheme();
  const lo = Math.min(...values, target?.low ?? Infinity) - 5;
  const hi = Math.max(...values, target?.high ?? -Infinity) + 5;
  const y = (v: number) => PAD + (1 - (v - lo) / (hi - lo || 1)) * (H - PAD * 2);
  const x = (i: number) => (values.length === 1 ? W / 2 : PAD + (i * (W - PAD * 2)) / (values.length - 1));
  const pointFill = { ok: colors.surface, warn: colors.warning, danger: colors.danger };
  return (
    <Svg width="100%" height={H} viewBox={`0 0 ${W} ${H}`} accessibilityRole="image" accessibilityLabel={label}>
      {target ? <Rect x={0} y={y(target.high)} width={W} height={Math.max(2, y(target.low) - y(target.high))} rx={6} fill={colors.successSoft} /> : null}
      <Polyline points={values.map((v, i) => `${x(i)},${y(v)}`).join(' ')} fill="none" stroke={colors.accentText} strokeWidth={2.5} strokeLinejoin="round" strokeLinecap="round" />
      {values.map((v, i) => (
        <Circle key={i} cx={x(i)} cy={y(v)} r={4} fill={pointFill[levels[i] ?? 'ok']} stroke={colors.accentText} strokeWidth={2} />
      ))}
    </Svg>
  );
}
