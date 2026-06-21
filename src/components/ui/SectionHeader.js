import React from 'react';
import { View } from 'react-native';
import AppText from './AppText';
import { spacing } from '../../theme';

// Small section label with an optional right-aligned action node.
export default function SectionHeader({ title, right, style }) {
  return (
    <View
      style={[
        { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: spacing.xl, marginBottom: spacing.sm },
        style,
      ]}
    >
      <AppText variant="label" color="textSecondary">{title}</AppText>
      {right ?? null}
    </View>
  );
}
