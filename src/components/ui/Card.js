import React from 'react';
import { View, Pressable } from 'react-native';
import { colors, radii, spacing, shadow } from '../../theme';

// Surface card. `alt` = the lavender surfaceAlt tile (no border/shadow); default = white
// raised card. Pass `onPress` to make it pressable.
export default function Card({ children, onPress, style, padded = true, alt = false }) {
  const base = {
    backgroundColor: alt ? colors.surfaceAlt : colors.surface,
    borderRadius: radii.lg,
    borderWidth: alt ? 0 : 1,
    borderColor: colors.border,
    padding: padded ? spacing.lg : 0,
    ...(alt ? null : shadow.card),
  };

  if (onPress) {
    return (
      <Pressable onPress={onPress} style={({ pressed }) => [base, pressed && { opacity: 0.85 }, style]}>
        {children}
      </Pressable>
    );
  }
  return <View style={[base, style]}>{children}</View>;
}
