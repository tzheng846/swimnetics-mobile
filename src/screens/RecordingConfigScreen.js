import React, { useState } from 'react';
import {
  View, Text, TouchableOpacity, TextInput,
  SafeAreaView, StyleSheet, ScrollView, KeyboardAvoidingView, Platform,
  ActivityIndicator, Alert,
} from 'react-native';
import { useBle } from '../context/BleContext';

const STROKES = [
  { key: 'breaststroke',          label: 'Breaststroke' },
  { key: 'freestyle',             label: 'Freestyle' },
  { key: 'backstroke',            label: 'Backstroke' },
  { key: 'butterfly',             label: 'Butterfly' },
  { key: 'im',                    label: 'Individual Medley' },
  { key: 'udk',                   label: 'Underwater Dolphin Kick' },
];

export default function RecordingConfigScreen({ route, navigation }) {
  const { athleteId, athleteName, defaultStrokeType, headWaistM } = route.params ?? {};
  const { knownDevices, connectedDevice, connectionStatus, connectToDevice } = useBle();

  const defaultStroke = STROKES.find(s => s.key === defaultStrokeType) ? defaultStrokeType : 'breaststroke';
  const [strokeType, setStrokeType] = useState(defaultStroke);
  const [sessionName, setSessionName] = useState('');
  const [sessionNotes, setSessionNotes] = useState('');
  const [connectingId, setConnectingId] = useState(null);

  const isConnected = connectionStatus === 'connected';

  const handleConnect = async (bleId) => {
    if (connectingId) return;
    setConnectingId(bleId);
    try {
      await connectToDevice(bleId);
    } catch (e) {
      Alert.alert('Connection Failed', e.message ?? 'Could not connect to device.');
    } finally {
      setConnectingId(null);
    }
  };

  const handleContinue = () => {
    if (!isConnected) return;
    navigation.navigate('Record', {
      athleteId,
      athleteName,
      headWaistM,
      strokeType,
      sessionName:  sessionName.trim()  || null,
      sessionNotes: sessionNotes.trim() || null,
    });
  };

  return (
    <SafeAreaView style={s.container}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <View style={s.header}>
          <TouchableOpacity onPress={() => navigation.goBack()}>
            <Text style={s.back}>‹ Athletes</Text>
          </TouchableOpacity>
          <Text style={s.title}>{athleteName}</Text>
          <View style={{ width: 60 }} />
        </View>

        <ScrollView contentContainerStyle={s.body} keyboardShouldPersistTaps="handled">

          {/* Device picker */}
          <Text style={s.label}>DEVICE</Text>
          {knownDevices.length === 0 ? (
            <View>
              <Text style={s.emptyDevices}>No paired devices.</Text>
              <TouchableOpacity onPress={() => navigation.navigate('Devices')}>
                <Text style={s.pairLink}>Pair a device →</Text>
              </TouchableOpacity>
            </View>
          ) : (
            knownDevices.map(d => {
              const rowConnected = connectedDevice?.id === d.bleId && isConnected;
              return (
                <TouchableOpacity
                  key={d.bleId}
                  style={s.deviceRow}
                  onPress={() => !rowConnected && handleConnect(d.bleId)}
                  disabled={rowConnected || connectingId === d.bleId}
                >
                  {rowConnected && <View style={s.connectedDot} />}
                  <View style={{ flex: 1 }}>
                    <Text style={s.deviceRowName}>{d.name}</Text>
                    {d.chipId ? <Text style={s.deviceRowChip}>{d.chipId}</Text> : null}
                  </View>
                  {connectingId === d.bleId
                    ? <ActivityIndicator color="#2196F3" size="small" />
                    : <Text style={rowConnected ? s.deviceConnectedText : s.deviceTapText}>
                        {rowConnected ? 'Connected' : 'Tap to connect'}
                      </Text>}
                </TouchableOpacity>
              );
            })
          )}

          {/* Stroke picker */}
          <Text style={s.label}>STROKE</Text>
          <View style={s.strokeGrid}>
            {STROKES.map(stroke => (
              <TouchableOpacity
                key={stroke.key}
                style={[s.strokeBtn, strokeType === stroke.key && s.strokeBtnActive]}
                onPress={() => setStrokeType(stroke.key)}
              >
                <Text style={[s.strokeBtnText, strokeType === stroke.key && s.strokeBtnTextActive]}>
                  {stroke.label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          {/* Session name */}
          <Text style={s.label}>SESSION NAME <Text style={s.optional}>(optional)</Text></Text>
          <TextInput
            style={s.input}
            placeholder="e.g. Sprint set, Race simulation…"
            placeholderTextColor="#555"
            value={sessionName}
            onChangeText={setSessionName}
            autoCapitalize="sentences"
            returnKeyType="next"
          />

          {/* Notes */}
          <Text style={s.label}>NOTES <Text style={s.optional}>(optional)</Text></Text>
          <TextInput
            style={[s.input, s.inputMulti]}
            placeholder="e.g. Felt strong on turns, tired at 40m…"
            placeholderTextColor="#555"
            value={sessionNotes}
            onChangeText={setSessionNotes}
            multiline
            numberOfLines={3}
            textAlignVertical="top"
            autoCapitalize="sentences"
          />

          <TouchableOpacity
            style={[s.continueBtn, !isConnected && s.continueBtnDisabled]}
            onPress={handleContinue}
            disabled={!isConnected}
          >
            <Text style={s.continueBtnText}>
              {isConnected ? 'Continue →' : 'Connect a device to continue'}
            </Text>
          </TouchableOpacity>

        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  container:           { flex: 1, backgroundColor: '#000' },
  header:              { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, marginTop: 16, marginBottom: 4 },
  back:                { color: '#2196F3', fontSize: 14 },
  title:               { color: '#fff', fontSize: 18, fontWeight: '700' },
  body:                { paddingHorizontal: 20, paddingBottom: 40, paddingTop: 16 },
  label:               { color: '#888', fontSize: 11, fontWeight: '600', letterSpacing: 1, marginBottom: 10, marginTop: 20 },
  optional:            { color: '#555', fontWeight: '400' },
  strokeGrid:          { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  strokeBtn:           { paddingHorizontal: 14, paddingVertical: 10, borderRadius: 8, backgroundColor: '#1a1a1a', borderWidth: 1, borderColor: '#333' },
  strokeBtnActive:     { backgroundColor: '#2196F3', borderColor: '#2196F3' },
  strokeBtnText:       { color: '#888', fontSize: 14, fontWeight: '500' },
  strokeBtnTextActive: { color: '#fff', fontWeight: '600' },
  input:               { backgroundColor: '#1a1a1a', color: '#fff', borderRadius: 8, paddingHorizontal: 16, paddingVertical: 12, fontSize: 15, borderWidth: 1, borderColor: '#333' },
  inputMulti:          { height: 88, paddingTop: 12 },
  continueBtn:         { backgroundColor: '#2196F3', borderRadius: 12, paddingVertical: 16, alignItems: 'center', marginTop: 32 },
  continueBtnDisabled: { backgroundColor: '#1a1a1a', borderWidth: 1, borderColor: '#333' },
  continueBtnText:     { color: '#fff', fontSize: 16, fontWeight: '700' },

  // Device picker
  emptyDevices:        { color: '#555', fontSize: 13, marginBottom: 6 },
  pairLink:            { color: '#2196F3', fontSize: 14, fontWeight: '600', marginBottom: 4 },
  deviceRow:           { flexDirection: 'row', alignItems: 'center', paddingVertical: 12, paddingHorizontal: 14, backgroundColor: '#1a1a1a', borderRadius: 8, borderWidth: 1, borderColor: '#333', marginBottom: 8 },
  connectedDot:        { width: 8, height: 8, borderRadius: 4, backgroundColor: '#27AE60', marginRight: 10 },
  deviceRowName:       { color: '#fff', fontSize: 15, fontWeight: '500' },
  deviceRowChip:       { color: '#555', fontSize: 11, marginTop: 2 },
  deviceConnectedText: { color: '#27AE60', fontSize: 12, fontWeight: '600' },
  deviceTapText:       { color: '#2196F3', fontSize: 12, fontWeight: '600' },
});
