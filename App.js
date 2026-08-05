import React from 'react';
import { ActivityIndicator, View } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { AuthProvider, useAuth } from './src/context/AuthContext';
import { BleProvider } from './src/context/BleContext';
import { UnitsProvider } from './src/context/UnitsContext';
import LoginScreen from './src/screens/LoginScreen';
import RootTabs from './src/navigation/RootTabs';
import UploadToast from './src/components/UploadToast';
import { colors } from './src/theme';

function Navigation() {
  const { session, loading } = useAuth();

  if (loading) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: colors.bg }}>
        <ActivityIndicator color={colors.primary} size="large" />
      </View>
    );
  }

  return session ? <RootTabs /> : <LoginScreen />;
}

export default function App() {
  return (
    <SafeAreaProvider>
      <AuthProvider>
        <UnitsProvider>
          <BleProvider>
            <NavigationContainer>
              <StatusBar style="dark" />
              <Navigation />
              {/* Global background-upload surface — overlays every screen (Phase 47-03) */}
              <UploadToast />
            </NavigationContainer>
          </BleProvider>
        </UnitsProvider>
      </AuthProvider>
    </SafeAreaProvider>
  );
}
