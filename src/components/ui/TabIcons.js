import React from 'react';
import Svg, { Rect, Circle, Path } from 'react-native-svg';

// Tab + settings icons as SVG (react-native-svg). Each takes { color, size }.
// The Record tab renders its own filled dot in TabBar, so no Record icon here.

export function DashboardIcon({ color = '#000', size = 24 }) {
  const sw = 2;
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Rect x="3" y="3" width="8" height="8" rx="2" stroke={color} strokeWidth={sw} />
      <Rect x="13" y="3" width="8" height="8" rx="2" stroke={color} strokeWidth={sw} />
      <Rect x="3" y="13" width="8" height="8" rx="2" stroke={color} strokeWidth={sw} />
      <Rect x="13" y="13" width="8" height="8" rx="2" stroke={color} strokeWidth={sw} />
    </Svg>
  );
}

export function TeamIcon({ color = '#000', size = 24 }) {
  const sw = 2;
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Circle cx="9" cy="8" r="3.2" stroke={color} strokeWidth={sw} />
      <Path d="M3 20c0-3.3 2.7-5.5 6-5.5s6 2.2 6 5.5" stroke={color} strokeWidth={sw} strokeLinecap="round" />
      <Circle cx="17.5" cy="9" r="2.4" stroke={color} strokeWidth={sw} />
      <Path d="M16 14.6c2.6-.2 5 1.4 5 4.4" stroke={color} strokeWidth={sw} strokeLinecap="round" />
    </Svg>
  );
}

export function HistoryIcon({ color = '#000', size = 24 }) {
  const sw = 2;
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Circle cx="12" cy="12" r="9" stroke={color} strokeWidth={sw} />
      <Path d="M12 7v5l3.5 2" stroke={color} strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}

export function SettingsIcon({ color = '#000', size = 24 }) {
  const sw = 2;
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Circle cx="12" cy="12" r="3.2" stroke={color} strokeWidth={sw} />
      <Path
        d="M12 2.5v2.5M12 19v2.5M2.5 12H5M19 12h2.5M5.1 5.1l1.8 1.8M17.1 17.1l1.8 1.8M18.9 5.1l-1.8 1.8M6.9 17.1l-1.8 1.8"
        stroke={color}
        strokeWidth={sw}
        strokeLinecap="round"
      />
    </Svg>
  );
}
