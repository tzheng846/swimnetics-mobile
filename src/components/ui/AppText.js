import React from 'react';
import { Text } from 'react-native';
import { colors, type } from '../../theme';

// Themed text. `variant` picks a type-scale role; `color` is a token key (e.g. "textSecondary")
// or a raw value as fallback.
export default function AppText({ variant = 'body', color = 'text', weight, style, children, ...rest }) {
  const base = type[variant] || type.body;
  const resolved = colors[color] || color;
  return (
    <Text style={[base, weight ? { fontWeight: weight } : null, { color: resolved }, style]} {...rest}>
      {children}
    </Text>
  );
}
