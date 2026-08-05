import React, { useState, useEffect, useCallback } from 'react';
import {
  View, TextInput, Pressable, Switch,
  ScrollView, KeyboardAvoidingView, Platform, ActivityIndicator, Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import AppText from '../components/ui/AppText';
import Button from '../components/ui/Button';
import { supabase } from '../lib/supabase';
import { useBle } from '../context/BleContext';
import { getStartSequenceEnabled, setStartSequenceEnabled } from '../lib/startSequencePrefs';
import { colors, spacing, radii } from '../theme';

const STROKES = [
  { key: 'breaststroke', label: 'Breast' },
  { key: 'freestyle', label: 'Free' },
  { key: 'backstroke', label: 'Back' },
  { key: 'butterfly', label: 'Fly' },
  { key: 'im', label: 'IM' },
  { key: 'udk', label: 'UDK' },
];

export default function RecordingConfigScreen({ route, navigation }) {
  const { athleteId, athleteName, defaultStrokeType, headWaistM } = route.params ?? {};
  const { knownDevices, connectedDevice, connectionStatus, ensureBleReady, connectToDevice } = useBle();

  const [athletes, setAthletes] = useState([]);
  const [athlete, setAthlete] = useState(
    athleteId ? { id: athleteId, name: athleteName, stroke_type: defaultStrokeType, head_waist_m: headWaistM } : null,
  );
  const [pickerOpen, setPickerOpen] = useState(false);
  const [strokeType, setStrokeType] = useState(
    STROKES.find(s => s.key === defaultStrokeType) ? defaultStrokeType : 'breaststroke',
  );
  const [sessionName, setSessionName] = useState('');
  const [sessionNotes, setSessionNotes] = useState('');
  const [connectingId, setConnectingId] = useState(null);
  const [startSequence, setStartSequence] = useState(true);

  const isConnected = connectionStatus === 'connected';

  // Refetch on focus, not on mount. This is a TAB screen: it mounts once per app launch and never
  // remounts, so a mount-only fetch left the roster frozen — a newly added athlete was missing and
  // a deleted one lingered, both until an app restart. Same pattern as Dashboard/Athletes/History.
  useFocusEffect(
    useCallback(() => {
      supabase.from('athletes').select('id, name, stroke_type, head_waist_m').order('name')
        .then(({ data }) => setAthletes(data ?? []));
    }, []),
  );

  // Apply params on arrival. They cannot be read in the useState initializers above: those run once,
  // at app launch, long before AthleteDetail navigates here. Prefer the roster row over the params
  // so head_waist_m/name/stroke_type come from the DB rather than the caller.
  useEffect(() => {
    if (!athleteId) return;
    const row = athletes.find(a => a.id === athleteId);
    setAthlete(row ?? { id: athleteId, name: athleteName, stroke_type: defaultStrokeType, head_waist_m: headWaistM });
    const stroke = (row?.stroke_type) ?? defaultStrokeType;
    if (STROKES.find(s => s.key === stroke)) setStrokeType(stroke);
    // Clear once consumed — on a screen that never unmounts, params persist indefinitely, so a
    // later plain Record-tab press would silently inherit this athlete.
    navigation.setParams({ athleteId: undefined, athleteName: undefined, defaultStrokeType: undefined });
  }, [athleteId, athletes]);

  useEffect(() => {
    getStartSequenceEnabled().then(setStartSequence);
  }, []);

  const toggleStartSequence = (v) => {
    setStartSequence(v);
    setStartSequenceEnabled(v);
  };

  const handleConnect = async (bleId) => {
    if (connectingId) return;
    const ready = await ensureBleReady();
    if (!ready.ok) { Alert.alert('Bluetooth', ready.reason); return; }
    setConnectingId(bleId);
    try {
      await connectToDevice(bleId);
    } catch (e) {
      Alert.alert('Connection failed', e.message ?? 'Could not connect to device.');
    } finally {
      setConnectingId(null);
    }
  };

  const pickAthlete = (a) => {
    setAthlete(a);
    if (STROKES.find(s => s.key === a.stroke_type)) setStrokeType(a.stroke_type);
    setPickerOpen(false);
  };

  const handleContinue = () => {
    if (!isConnected || !athlete) return;
    navigation.navigate('Record', {
      athleteId: athlete.id,
      athleteName: athlete.name,
      headWaistM: athlete.head_waist_m ?? 0,
      strokeType,
      sessionName: sessionName.trim() || null,
      sessionNotes: sessionNotes.trim() || null,
      startSequence,
    });
  };

  return (
    <SafeAreaView edges={['top']} style={{ flex: 1, backgroundColor: colors.bg }}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: spacing.lg, marginTop: spacing.md, marginBottom: spacing.xs }}>
          <Pressable onPress={() => navigation.goBack()} accessibilityLabel="Back" hitSlop={10}>
            <AppText variant="title" color="text">‹</AppText>
          </Pressable>
          <AppText variant="title">New session</AppText>
        </View>

        <ScrollView contentContainerStyle={{ paddingHorizontal: spacing.lg, paddingBottom: 40, paddingTop: spacing.sm }} keyboardShouldPersistTaps="handled">
          {/* Athlete picker */}
          <AppText variant="label" color="textSecondary" style={st.label}>Athlete</AppText>
          <Pressable style={st.select} onPress={() => setPickerOpen(o => !o)}>
            <AppText variant="body" color={athlete ? 'text' : 'textMuted'}>{athlete?.name || 'Choose an athlete'}</AppText>
            <AppText color="periwinkle">{pickerOpen ? '▴' : '▾'}</AppText>
          </Pressable>
          {pickerOpen && (
            <View style={st.pickerList}>
              {athletes.length === 0 ? (
                <AppText variant="caption" color="textMuted" style={{ padding: spacing.md }}>No athletes yet.</AppText>
              ) : athletes.map(a => (
                <Pressable key={a.id} style={st.pickerRow} onPress={() => pickAthlete(a)}>
                  <AppText variant="body" color={athlete?.id === a.id ? 'primary' : 'text'}>{a.name}</AppText>
                  {athlete?.id === a.id ? <AppText color="primary">✓</AppText> : null}
                </Pressable>
              ))}
            </View>
          )}

          {/* Device picker */}
          <AppText variant="label" color="textSecondary" style={st.label}>Device</AppText>
          {knownDevices.length === 0 ? (
            <View>
              <AppText variant="caption" color="textMuted" style={{ marginBottom: 6 }}>No paired devices.</AppText>
              <Pressable onPress={() => navigation.navigate('Devices')}><AppText color="primary">Pair a device →</AppText></Pressable>
            </View>
          ) : (
            knownDevices.map(d => {
              const rowConnected = connectedDevice?.id === d.bleId && isConnected;
              return (
                <Pressable
                  key={d.bleId}
                  style={st.deviceRow}
                  onPress={() => !rowConnected && handleConnect(d.bleId)}
                  disabled={rowConnected || connectingId === d.bleId}
                >
                  {rowConnected && <View style={st.connectedDot} />}
                  <View style={{ flex: 1 }}>
                    <AppText variant="body" color="text">{d.name}</AppText>
                    {d.chipId ? <AppText variant="caption" color="textMuted">{d.chipId}</AppText> : null}
                  </View>
                  {connectingId === d.bleId
                    ? <ActivityIndicator color={colors.primary} size="small" />
                    : <AppText variant="caption" color={rowConnected ? 'good' : 'primary'} weight="600">{rowConnected ? 'Connected' : 'Tap to connect'}</AppText>}
                </Pressable>
              );
            })
          )}

          {/* Stroke picker */}
          <AppText variant="label" color="textSecondary" style={st.label}>Stroke</AppText>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {STROKES.map(stroke => {
              const on = strokeType === stroke.key;
              return (
                <Pressable key={stroke.key} style={[st.strokeBtn, on && st.strokeBtnOn]} onPress={() => setStrokeType(stroke.key)}>
                  <AppText variant="label" color={on ? colors.white : 'textSecondary'}>{stroke.label}</AppText>
                </Pressable>
              );
            })}
          </View>

          {/* Session name */}
          <AppText variant="label" color="textSecondary" style={st.label}>Session name <AppText variant="label" color="textMuted">(optional)</AppText></AppText>
          <TextInput
            style={st.input}
            placeholder="e.g. Sprint set, Race simulation…"
            placeholderTextColor={colors.textMuted}
            value={sessionName}
            onChangeText={setSessionName}
            autoCapitalize="sentences"
            returnKeyType="next"
          />

          {/* Notes */}
          <AppText variant="label" color="textSecondary" style={st.label}>Notes <AppText variant="label" color="textMuted">(optional)</AppText></AppText>
          <TextInput
            style={[st.input, { height: 88, paddingTop: 12 }]}
            placeholder="e.g. Felt strong on turns, tired at 40m…"
            placeholderTextColor={colors.textMuted}
            value={sessionNotes}
            onChangeText={setSessionNotes}
            multiline
            numberOfLines={3}
            textAlignVertical="top"
            autoCapitalize="sentences"
          />

          {/* Race-start sequence */}
          <View style={st.toggleRow}>
            <View style={{ flex: 1, paddingRight: spacing.md }}>
              <AppText variant="body" color="text">Race start sequence</AppText>
              <AppText variant="caption" color="textMuted">Countdown + “take your marks” + start horn</AppText>
            </View>
            <Switch
              value={startSequence}
              onValueChange={toggleStartSequence}
              trackColor={{ true: colors.primary, false: colors.border }}
            />
          </View>

          <Button
            title={!athlete ? 'Choose an athlete' : isConnected ? 'Start recording' : 'Connect a device to continue'}
            onPress={handleContinue}
            disabled={!isConnected || !athlete}
            style={{ marginTop: spacing.xxl }}
          />
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const st = {
  label: { marginTop: spacing.xl, marginBottom: spacing.sm },
  select: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radii.md, paddingHorizontal: 14, paddingVertical: 13 },
  pickerList: { marginTop: 6, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radii.md, overflow: 'hidden' },
  pickerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 14, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: colors.surfaceAlt },
  deviceRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12, paddingHorizontal: 14, backgroundColor: colors.surface, borderRadius: radii.md, borderWidth: 1, borderColor: colors.border, marginBottom: 8 },
  connectedDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.good, marginRight: 10 },
  toggleRow: { flexDirection: 'row', alignItems: 'center', marginTop: spacing.xl, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radii.md, paddingHorizontal: 14, paddingVertical: 12 },
  strokeBtn: { paddingHorizontal: 14, paddingVertical: 10, borderRadius: radii.md, backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: colors.border },
  strokeBtnOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  input: { backgroundColor: colors.surfaceAlt, color: colors.text, borderRadius: radii.md, paddingHorizontal: 16, paddingVertical: 12, fontSize: 15, borderWidth: 1, borderColor: colors.border },
};
