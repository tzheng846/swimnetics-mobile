import React from 'react';
import { View } from 'react-native';
import { bandDotStyle } from '../../lib/indicators';

// The band indicator. One component so the roster and the dashboard render the identical dot for
// the identical data — that identity is the point of Phase 84-03, not an implementation detail.
export default function BandDot({ band, provisional, ratingColors, size = 10 }) {
  return <View style={bandDotStyle(band, ratingColors, provisional, size)} />;
}
