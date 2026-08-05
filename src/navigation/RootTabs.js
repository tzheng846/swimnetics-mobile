import React from 'react';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import TabBar from '../components/ui/TabBar';
import DashboardScreen from '../screens/DashboardScreen';
import AthletesScreen from '../screens/AthletesScreen';
import RecordingConfigScreen from '../screens/RecordingConfigScreen';
import SessionHistoryScreen from '../screens/SessionHistoryScreen';
import RecordScreen from '../screens/RecordScreen';
import ReportCardScreen from '../screens/ReportCardScreen';
import VideoOverlayScreen from '../screens/VideoOverlayScreen';
import DevicesScreen from '../screens/DevicesScreen';
import DiagnosticsScreen from '../screens/DiagnosticsScreen';
import SettingsScreen from '../screens/SettingsScreen';
import AthleteDetailScreen from '../screens/AthleteDetailScreen';
import CompareScreen from '../screens/CompareScreen';

const Tab = createBottomTabNavigator();
const Root = createNativeStackNavigator();

// Four tab homes. A plain navigate('RecordingConfig') works only from a TAB SIBLING (e.g.
// AthletesScreen) — navigate() resolves a route name by bubbling UP through parent navigators and
// never descends into a child navigator. Screens on the Root stack below (AthleteDetail, ReportCard,
// Compare, …) must therefore use the nested form to reach a tab:
//     navigation.navigate('Tabs', { screen: 'RecordingConfig', params: { … } })
// Getting this wrong fails SILENTLY — the action reaches the top unhandled and is dropped, which is
// exactly how AthleteDetail's Record button did nothing from Phase 38-03 until Phase 55-01.
//
// Note these tab screens mount once per app launch and never remount: read route params in an
// effect, not in a useState initializer, and refetch data with useFocusEffect rather than on mount.
function Tabs() {
  return (
    <Tab.Navigator screenOptions={{ headerShown: false }} tabBar={(props) => <TabBar {...props} />}>
      <Tab.Screen name="Dashboard" component={DashboardScreen} />
      <Tab.Screen name="Team" component={AthletesScreen} />
      <Tab.Screen name="RecordingConfig" component={RecordingConfigScreen} />
      <Tab.Screen name="SessionHistory" component={SessionHistoryScreen} />
    </Tab.Navigator>
  );
}

// Detail screens push full-screen over the tab bar (standard tabs-in-stack pattern).
export default function RootTabs() {
  return (
    <Root.Navigator screenOptions={{ headerShown: false }}>
      <Root.Screen name="Tabs" component={Tabs} />
      <Root.Screen name="Record" component={RecordScreen} />
      <Root.Screen name="VideoOverlay" component={VideoOverlayScreen} />
      <Root.Screen name="ReportCard" component={ReportCardScreen} />
      <Root.Screen name="Devices" component={DevicesScreen} />
      <Root.Screen name="Diagnostics" component={DiagnosticsScreen} />
      <Root.Screen name="Settings" component={SettingsScreen} />
      <Root.Screen name="AthleteDetail" component={AthleteDetailScreen} />
      <Root.Screen name="Compare" component={CompareScreen} />
    </Root.Navigator>
  );
}
