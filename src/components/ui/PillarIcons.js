import React from 'react';
import Svg, { Path, Rect, Circle } from 'react-native-svg';

// Pillar glyphs (Phase 38 locked): Speed=gauge, Stroke length=ruler, Consistency=wave,
// Endurance=battery. Each takes { color, size }. Keyed by ratings.PILLARS key.

export function GaugeIcon({ color = '#000', size = 16 }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path d="M4 16a8 8 0 0 1 16 0" stroke={color} strokeWidth={2} strokeLinecap="round" />
      <Path d="M12 16l4-3" stroke={color} strokeWidth={2} strokeLinecap="round" />
      <Circle cx="12" cy="16" r="1.6" fill={color} />
    </Svg>
  );
}

export function RulerIcon({ color = '#000', size = 16 }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Rect x="3" y="8" width="18" height="8" rx="1.5" stroke={color} strokeWidth={2} />
      <Path d="M7 8v3M11 8v4M15 8v3" stroke={color} strokeWidth={2} strokeLinecap="round" />
    </Svg>
  );
}

export function WaveIcon({ color = '#000', size = 16 }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path d="M3 12c2-5 4-5 6 0s4 5 6 0 4-5 6 0" stroke={color} strokeWidth={2} strokeLinecap="round" />
    </Svg>
  );
}

export function BatteryIcon({ color = '#000', size = 16 }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Rect x="3" y="8" width="15" height="9" rx="2" stroke={color} strokeWidth={2} />
      <Rect x="19" y="11" width="2.5" height="3" rx="1" fill={color} />
      <Rect x="5.5" y="10" width="6" height="5" rx="1" fill={color} />
    </Svg>
  );
}

const MAP = {
  speed: GaugeIcon,
  stroke_length: RulerIcon,
  consistency: WaveIcon,
  endurance: BatteryIcon,
};

export function PillarIcon({ pillarKey, color = '#000', size = 16 }) {
  const Icon = MAP[pillarKey] || GaugeIcon;
  return <Icon color={color} size={size} />;
}
