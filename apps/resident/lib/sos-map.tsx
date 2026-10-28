import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import Svg, { Circle, Line, Path, Text as SvgText } from 'react-native-svg';
import { Text, useTheme } from '@repo/ui-native';

type Point = { lat: number; lng: number };

const HEIGHT = 220;
/** Distances beyond this sit on the outer ring. */
const MAX_M = 10_000;

/** Compass bearing from `a` to `b`, in radians (0 = north, clockwise). */
function bearing(a: Point, b: Point) {
  const rad = Math.PI / 180;
  const y = Math.sin((b.lng - a.lng) * rad) * Math.cos(b.lat * rad);
  const x = Math.cos(a.lat * rad) * Math.sin(b.lat * rad) - Math.sin(a.lat * rad) * Math.cos(b.lat * rad) * Math.cos((b.lng - a.lng) * rad);
  return Math.atan2(y, x);
}

/** Log scale, so 300 m and 8 km are both readable on a phone. */
const scale = (m: number) => Math.min(1, Math.log10(1 + m / 100) / Math.log10(1 + MAX_M / 100));

export const km = (m: number) => (m / 1000).toFixed(m < 10_000 ? 1 : 0);

/**
 * Where the ambulance is relative to you: you in the middle, the ambulance
 * at its compass bearing and (log-scaled) distance. Stands in for the
 * street map (react-native-maps) until a Google Maps key is configured.
 */
export function SosMap({ you, ambulance, distanceM, width }: { you: Point | null; ambulance: Point | null; distanceM: number | null; width: number }) {
  const { t } = useTranslation();
  const { colors, fonts, space } = useTheme();
  const cx = width / 2;
  const cy = HEIGHT / 2;
  const outer = Math.min(cx, cy) - 18;
  const amb =
    you && ambulance && distanceM !== null
      ? (() => {
          const b = bearing(you, ambulance);
          const r = Math.max(22, scale(distanceM) * outer);
          return { x: cx + r * Math.sin(b), y: cy - r * Math.cos(b) };
        })()
      : null;
  const label = amb && distanceM !== null ? t('sos.mapA11y', { km: km(distanceM) }) : t('sos.mapA11yNone');

  return (
    <View accessible accessibilityRole="image" accessibilityLabel={label} style={{ gap: space[1] }}>
      <Svg width={width} height={HEIGHT}>
        <Path d={`M0 0H${width}V${HEIGHT}H0Z`} fill={colors.mapBg} />
        <Line x1={0} y1={cy} x2={width} y2={cy} stroke={colors.mapRoad} strokeWidth={10} />
        <Line x1={cx} y1={0} x2={cx} y2={HEIGHT} stroke={colors.mapRoad} strokeWidth={10} />
        {[outer * scale(1000), outer * scale(5000), outer].map((r) => (
          <Circle key={r} cx={cx} cy={cy} r={r} fill="none" stroke={colors.mapBlock} strokeWidth={1.5} strokeDasharray="4 6" />
        ))}
        {amb ? <Line x1={cx} y1={cy} x2={amb.x} y2={amb.y} stroke={colors.danger} strokeWidth={3} strokeDasharray="8 7" strokeLinecap="round" /> : null}
        <Circle cx={cx} cy={cy} r={20} fill={colors.accent} opacity={0.2} />
        <Circle cx={cx} cy={cy} r={9} fill={colors.accent} stroke={colors.mapBg} strokeWidth={3} />
        <SvgText x={cx + 16} y={cy - 12} fill={colors.mapText} fontFamily={fonts.body.native.semibold} fontSize={11}>
          {t('sos.mapYou')}
        </SvgText>
        {amb ? (
          <>
            <Circle cx={amb.x} cy={amb.y} r={22} fill={colors.mapAmbulance} opacity={0.18} />
            <Circle cx={amb.x} cy={amb.y} r={13} fill={colors.mapAmbulance} />
            <Path d={`M${amb.x} ${amb.y - 6}v12M${amb.x - 6} ${amb.y}h12`} stroke={colors.onDanger} strokeWidth={2.6} strokeLinecap="round" />
            {/* Beside the marker, on the side away from the screen edge, clear of the route line. */}
            <SvgText x={amb.x < width - 90 ? amb.x + 26 : amb.x - 26} y={amb.y + 4} fill={colors.mapText} fontFamily={fonts.mono.native.semibold} fontSize={11} textAnchor={amb.x < width - 90 ? 'start' : 'end'}>
              {`${km(distanceM!)} km`}
            </SvgText>
          </>
        ) : null}
      </Svg>
      <Text variant="caption" tone="muted" style={{ paddingHorizontal: space[5] }}>
        {t('sos.mapNote')}
      </Text>
    </View>
  );
}
