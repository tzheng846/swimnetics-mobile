import React from 'react';
import { Pressable, ActivityIndicator } from 'react-native';
import AppText from './AppText';
import { colors, radii, spacing } from '../../theme';

const VARIANTS = {
  primary:   { bg: colors.primary,    fg: colors.white,     border: null,         pressedBg: colors.primaryPressed },
  secondary: { bg: colors.surfaceAlt, fg: colors.primary,   border: colors.border, pressedBg: colors.secondaryPressed },
  accent:    { bg: colors.accent,     fg: colors.accentText, border: null,        pressedBg: colors.accentPressed },
  ghost:     { bg: 'transparent',     fg: colors.secondary, border: null,         pressedBg: colors.surfaceAlt },
  danger:    { bg: colors.needsWork,  fg: colors.white,     border: null,         pressedBg: colors.dangerPressed },
};

const SIZES = { md: { py: 14, fontSize: 15 }, sm: { py: 9, fontSize: 13 } };

export default function Button({
  title, onPress, variant = 'primary', size = 'md',
  loading = false, disabled = false, full = true, style,
}) {
  const v = VARIANTS[variant] || VARIANTS.primary;
  const sz = SIZES[size] || SIZES.md;
  const isDisabled = disabled || loading;

  return (
    <Pressable
      onPress={onPress}
      disabled={isDisabled}
      style={({ pressed }) => [
        {
          backgroundColor: pressed ? v.pressedBg : v.bg,
          borderWidth: v.border ? 1 : 0,
          borderColor: v.border || 'transparent',
          borderRadius: radii.md,
          paddingVertical: sz.py,
          paddingHorizontal: spacing.xl,
          alignItems: 'center',
          justifyContent: 'center',
          alignSelf: full ? 'stretch' : 'flex-start',
          opacity: isDisabled ? 0.5 : 1,
        },
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={v.fg} />
      ) : (
        <AppText color={v.fg} style={{ fontSize: sz.fontSize, fontWeight: '600' }}>{title}</AppText>
      )}
    </Pressable>
  );
}
