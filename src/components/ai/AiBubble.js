import React, { useState } from 'react';
import { Pressable } from 'react-native';
import Svg, { Path, Circle } from 'react-native-svg';
import CoachChatSheet from './CoachChatSheet';
import { colors, spacing, shadow } from '../../theme';

export function ChatIcon({ color, size = 24 }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path d="M4 5h16v11H9l-4 3v-3H4z" stroke={color} strokeWidth={2} strokeLinejoin="round" />
      <Circle cx="9" cy="10.5" r="1" fill={color} />
      <Circle cx="12" cy="10.5" r="1" fill={color} />
      <Circle cx="15" cy="10.5" r="1" fill={color} />
    </Svg>
  );
}

// Floating, non-invasive AI entry point. Absolute within its parent (NOT position:fixed) so it
// sits above the tab bar. Mounted on Dashboard / session / compare (reusable).
export default function AiBubble({ anchorSessionId, token, open: controlledOpen, onOpenChange }) {
  const [internalOpen, setInternalOpen] = useState(false);
  const open = controlledOpen !== undefined ? controlledOpen : internalOpen;
  const setOpen = (v) => (onOpenChange ? onOpenChange(v) : setInternalOpen(v));
  return (
    <>
      <Pressable
        onPress={() => setOpen(true)}
        accessibilityRole="button"
        accessibilityLabel="Coach AI"
        style={{
          position: 'absolute',
          right: spacing.lg,
          bottom: spacing.lg,
          width: 52,
          height: 52,
          borderRadius: 26,
          backgroundColor: colors.primary,
          alignItems: 'center',
          justifyContent: 'center',
          ...shadow.island,
        }}
      >
        <ChatIcon color={colors.white} size={24} />
      </Pressable>
      <CoachChatSheet visible={open} onClose={() => setOpen(false)} anchorSessionId={anchorSessionId} token={token} />
    </>
  );
}
