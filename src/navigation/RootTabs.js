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

// Four tab homes. Route names match existing navigate() targets so cross-screen
// navigation keeps working: "RecordingConfig" (Record island) and "SessionHistory"
// (History) are reached by name from AthletesScreen.
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
