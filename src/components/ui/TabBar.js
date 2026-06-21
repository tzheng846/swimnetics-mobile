import React from 'react';
import { View, Pressable } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import AppText from './AppText';
import { DashboardIcon, TeamIcon, HistoryIcon } from './TabIcons';
import { colors, spacing, radii, shadow } from '../../theme';

// Custom bottom tab bar (iOS-News+ style): Dashboard / Team / History grouped in a frosted
// lavender pill; the Record route (name "RecordingConfig") is a detached circular button.
const ICONS = { Dashboard: DashboardIcon, Team: TeamIcon, SessionHistory: HistoryIcon };
const LABELS = { Dashboard: 'Dashboard', Team: 'Team', SessionHistory: 'History' };

export default function TabBar({ state, navigation }) {
  const insets = useSafeAreaInsets();
  const recordRoute = state.routes.find((r) => r.name === 'RecordingConfig');
  const pillRoutes = state.routes.filter((r) => r.name !== 'RecordingConfig');

  const press = (route) => {
    const focused = state.index === state.routes.indexOf(route);
    const event = navigation.emit({ type: 'tabPress', target: route.key, canPreventDefault: true });
    if (!focused && !event.defaultPrevented) navigation.navigate(route.name);
  };

  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        paddingHorizontal: spacing.lg,
        paddingTop: spacing.sm,
        paddingBottom: Math.max(insets.bottom, spacing.sm),
        backgroundColor: 'transparent',
      }}
    >
      {/* Grouped pill */}
      <View
        style={{
          flex: 1,
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-around',
          backgroundColor: colors.surfaceAlt,
          borderWidth: 1,
          borderColor: colors.border,
          borderRadius: radii.pill,
          paddingVertical: spacing.sm,
          ...shadow.card,
        }}
      >
        {pillRoutes.map((route) => {
          const focused = state.index === state.routes.indexOf(route);
          const Icon = ICONS[route.name];
          const tint = focused ? colors.primary : colors.textMuted;
          return (
            <Pressable
              key={route.key}
              onPress={() => press(route)}
              accessibilityRole="button"
              accessibilityState={{ selected: focused }}
              accessibilityLabel={LABELS[route.name]}
              style={{ alignItems: 'center', paddingHorizontal: 8, paddingVertical: 2 }}
            >
              {Icon ? <Icon color={tint} size={22} /> : null}
              <AppText color={focused ? 'primary' : 'textMuted'} style={{ marginTop: 2, fontSize: 10 }}>
                {LABELS[route.name]}
              </AppText>
            </Pressable>
          );
        })}
      </View>

      {/* Detached Record button */}
      {recordRoute ? (
        <Pressable
          onPress={() => press(recordRoute)}
          accessibilityRole="button"
          accessibilityLabel="Record"
          style={{
            width: 60,
            height: 60,
            borderRadius: 30,
            backgroundColor: colors.primary,
            alignItems: 'center',
            justifyContent: 'center',
            ...shadow.island,
          }}
        >
          <View style={{ width: 20, height: 20, borderRadius: 10, backgroundColor: colors.white }} />
        </Pressable>
      ) : null}
    </View>
  );
}
