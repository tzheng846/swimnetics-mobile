import React from 'react';
import { ActivityIndicator, View } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { StatusBar } from 'expo-status-bar';
import { AuthProvider, useAuth } from './src/context/AuthContext';
import { BleProvider } from './src/context/BleContext';
import LoginScreen from './src/screens/LoginScreen';
import AthletesScreen from './src/screens/AthletesScreen';
import RecordScreen from './src/screens/RecordScreen';
import SessionHistoryScreen from './src/screens/SessionHistoryScreen';
import ReportCardScreen from './src/screens/ReportCardScreen';
import RecordingConfigScreen from './src/screens/RecordingConfigScreen';
import DevicesScreen from './src/screens/DevicesScreen';
import DiagnosticsScreen from './src/screens/DiagnosticsScreen';
import VideoOverlayScreen from './src/screens/VideoOverlayScreen';

const Stack = createNativeStackNavigator();

function Navigation() {
  const { session, loading } = useAuth();

  if (loading) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#000' }}>
        <ActivityIndicator color="#2196F3" size="large" />
      </View>
    );
  }

  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      {session ? (
        <>
          <Stack.Screen name="Athletes" component={AthletesScreen} />
          <Stack.Screen name="RecordingConfig" component={RecordingConfigScreen} />
          <Stack.Screen name="Record" component={RecordScreen} />
          <Stack.Screen name="SessionHistory" component={SessionHistoryScreen} />
          <Stack.Screen name="ReportCard" component={ReportCardScreen} />
          <Stack.Screen name="Devices" component={DevicesScreen} />
          <Stack.Screen name="Diagnostics" component={DiagnosticsScreen} />
          <Stack.Screen name="VideoOverlay" component={VideoOverlayScreen} />
        </>
      ) : (
        <Stack.Screen name="Login" component={LoginScreen} />
      )}
    </Stack.Navigator>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <BleProvider>
        <NavigationContainer>
          <StatusBar style="light" />
          <Navigation />
        </NavigationContainer>
      </BleProvider>
    </AuthProvider>
  );
}
