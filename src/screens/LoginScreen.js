import React, { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity,
  ActivityIndicator, SafeAreaView, StyleSheet, KeyboardAvoidingView, Platform,
} from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { supabase } from '../lib/supabase';

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
    // On success: AuthContext.onAuthStateChange fires → App.js shows RecordScreen
  };

  return (
    <SafeAreaView style={s.container}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={s.inner}
      >
        <Svg width={180} height={48} style={{ marginBottom: 16 }}>
          <Path
            d="M 10 30 C 28 10, 45 10, 63 30 C 81 50, 98 50, 116 30 C 134 10, 151 10, 170 30"
            stroke="#5B8DEF"
            strokeWidth={3}
            fill="none"
            strokeLinecap="round"
          />
        </Svg>
        <Text style={s.title}>SWIMNETICS</Text>
        <Text style={s.tagline}>VELOCITY INTELLIGENCE</Text>

        <TextInput
          style={s.input}
          placeholder="Email"
          placeholderTextColor="#666"
          value={email}
          onChangeText={setEmail}
          keyboardType="email-address"
          autoCapitalize="none"
          autoCorrect={false}
        />
        <TextInput
          style={s.input}
          placeholder="Password"
          placeholderTextColor="#666"
          value={password}
          onChangeText={setPassword}
          secureTextEntry
          autoCapitalize="none"
        />

        <TouchableOpacity
          style={[s.button, loading && s.buttonDisabled]}
          onPress={handleSignIn}
          disabled={loading}
        >
          {loading
            ? <ActivityIndicator color="#fff" />
            : <Text style={s.buttonText}>Sign In</Text>
          }
        </TouchableOpacity>

        {error ? <Text style={s.error}>{error}</Text> : null}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  container:      { flex: 1, backgroundColor: '#000' },
  inner:          { flex: 1, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 32 },
  title:          { color: '#fff', fontSize: 26, fontWeight: '700', textAlign: 'center', letterSpacing: 6, marginBottom: 6 },
  tagline:        { color: '#F59E0B', fontSize: 11, letterSpacing: 3, textAlign: 'center', marginBottom: 40 },
  input:          {
    backgroundColor: '#1a1a1a',
    color: '#fff',
    borderRadius: 8,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#333',
    width: '100%',
  },
  button:         {
    backgroundColor: '#2196F3',
    borderRadius: 8,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 8,
    width: '100%',
  },
  buttonDisabled: { opacity: 0.6 },
  buttonText:     { color: '#fff', fontSize: 16, fontWeight: '600' },
  error:          { color: '#FF5252', marginTop: 16, textAlign: 'center', fontSize: 14 },
});
