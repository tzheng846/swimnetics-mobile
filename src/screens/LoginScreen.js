import React, { useState } from 'react';
import { View, TextInput } from 'react-native';
import Screen from '../components/ui/Screen';
import AppText from '../components/ui/AppText';
import Button from '../components/ui/Button';
import { supabase } from '../lib/supabase';
import { colors, radii, spacing } from '../theme';

export default function LoginScreen() {
  const [email, setEmail]       = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState(null);

  const handleSignIn = async () => {
    setError(null);
    setLoading(true);
    const { error } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    });
    setLoading(false);
    if (error) setError(error.message);
    // On success: AuthContext.onAuthStateChange fires → App.js shows RootTabs
  };

  return (
    <Screen keyboardAvoiding contentStyle={{ flex: 1, justifyContent: 'center' }}>
      <View style={{ alignItems: 'center', marginBottom: spacing.xxxl }}>
        <AppText variant="label" color="periwinkle" style={{ letterSpacing: 3 }}>velocity intelligence</AppText>
        <AppText variant="display" style={{ marginTop: 6 }}>swimnetics</AppText>
      </View>

      <AppText variant="label" color="textSecondary" style={{ marginBottom: 6 }}>Email</AppText>
      <TextInput
        style={inputStyle}
        placeholder="coach@team.com"
        placeholderTextColor={colors.textMuted}
        value={email}
        onChangeText={setEmail}
        keyboardType="email-address"
        autoCapitalize="none"
        autoCorrect={false}
      />

      <AppText variant="label" color="textSecondary" style={{ marginTop: spacing.lg, marginBottom: 6 }}>Password</AppText>
      <TextInput
        style={inputStyle}
        placeholder="••••••••"
        placeholderTextColor={colors.textMuted}
        value={password}
        onChangeText={setPassword}
        secureTextEntry
        autoCapitalize="none"
      />

      <Button title="Sign in" onPress={handleSignIn} loading={loading} style={{ marginTop: spacing.xxl }} />

      {error ? (
        <AppText color="needsWork" style={{ marginTop: spacing.lg, textAlign: 'center' }}>{error}</AppText>
      ) : null}
    </Screen>
  );
}

const inputStyle = {
  backgroundColor: colors.surfaceAlt,
  color: colors.text,
  borderRadius: radii.md,
  paddingHorizontal: 14,
  paddingVertical: 12,
  fontSize: 15,
  borderWidth: 1,
  borderColor: colors.border,
};
