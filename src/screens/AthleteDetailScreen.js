import React, { useState, useEffect, useCallback } from 'react';
import { View, Pressable, Alert, Share, ActivityIndicator, TextInput } from 'react-native';
import * as Crypto from 'expo-crypto';
import Screen from '../components/ui/Screen';
import AppText from '../components/ui/AppText';
import Card from '../components/ui/Card';
import Button from '../components/ui/Button';
import SectionHeader from '../components/ui/SectionHeader';
import { PillarIcon } from '../components/ui/PillarIcons';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import { WEB_BASE } from '../config';
import { colors, spacing, radii } from '../theme';

const REPORT_METRIC_KEYS = ['mean_vel_ms', 'max_vel_ms', 'stroke_rate_spm', 'mean_dps_m', 'lap_time_s', 'cv_arm_peak_vel'];
const BAND_LABEL = { good: 'good', ok: 'ok', needs_work: 'needs work', unknown: '—' };
// Bands are snake_case; token keys are camelCase — map explicitly.
const BAND_COLOR = { good: colors.good, ok: colors.ok, needs_work: colors.needsWork };

export default function AthleteDetailScreen({ route, navigation }) {
  const athlete = route.params?.athlete || {};
  const { session, coachId } = useAuth();

  const [sessions, setSessions] = useState(null);
  const [sending, setSending] = useState(false);
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(athlete.name || '');
  const [hw, setHw] = useState('');

  const fetchSessions = useCallback(() => {
    supabase
      .from('sessions')
      .select('id, created_at, name, metrics_json, stroke_type')
      .eq('athlete_id', athlete.athlete_id)
      .order('created_at', { ascending: false })
      .then(({ data }) => setSessions(data ?? []));
  }, [athlete.athlete_id]);

  useEffect(() => { fetchSessions(); }, [fetchSessions]);

  useEffect(() => {
    supabase.from('athletes').select('head_waist_m').eq('id', athlete.athlete_id).single()
      .then(({ data }) => { if (data?.head_waist_m != null) setHw(String(data.head_waist_m)); });
  }, [athlete.athlete_id]);

  const sendReport = async () => {
    setSending(true);
    try {
      const token = Crypto.randomUUID();
      const { error } = await supabase.from('reports').insert({
        athlete_id: athlete.athlete_id,
        coach_id: coachId ?? null,
        token,
        config_json: { start: null, end: null, metrics: REPORT_METRIC_KEYS, message: null },
      });
      if (error) throw error;
      const url = `${WEB_BASE}/report/${token}`;
      const first = (athlete.name || 'your swimmer').split(' ')[0];
      const result = await Share.share({ message: `Here is ${first}'s swim progress report:\n${url}` });
      if (result.action === Share.sharedAction) {
        await supabase.from('reports').update({ sent_at: new Date().toISOString() }).eq('token', token);
      }
    } catch (e) {
      Alert.alert('Error', e.message || 'Could not create the report.');
    } finally {
      setSending(false);
    }
  };

  const saveEdit = async () => {
    const updates = { name: name.trim() || athlete.name };
    const parsed = hw.trim() !== '' ? parseFloat(hw) : null;
    updates.head_waist_m = Number.isNaN(parsed) ? null : parsed;
    const { error } = await supabase.from('athletes').update(updates).eq('id', athlete.athlete_id);
    if (error) Alert.alert('Error', error.message);
    setEditing(false);
  };

  const confirmDelete = () => {
    Alert.alert('Delete athlete', `Delete ${athlete.name}? This also removes their sessions.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete', style: 'destructive',
        onPress: async () => {
          const { error } = await supabase.from('athletes').delete().eq('id', athlete.athlete_id);
          if (error) { Alert.alert('Error', error.message); return; }
          navigation.goBack();
        },
      },
    ]);
  };

  const openMenu = () => {
    Alert.alert(athlete.name || 'Athlete', undefined, [
      { text: 'Edit fields', onPress: () => setEditing(true) },
      { text: 'Delete athlete', style: 'destructive', onPress: confirmDelete },
      { text: 'Cancel', style: 'cancel' },
    ]);
  };

  const pillars = athlete.pillars || [];

  return (
    <Screen scroll>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: spacing.md }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1 }}>
          <Pressable onPress={() => navigation.goBack()} accessibilityLabel="Back" hitSlop={10}>
            <AppText variant="title" color="text">‹</AppText>
          </Pressable>
          <AppText variant="title" numberOfLines={1} style={{ flex: 1 }}>{athlete.name}</AppText>
        </View>
        <Pressable onPress={openMenu} accessibilityLabel="Athlete options" hitSlop={10}>
          <AppText variant="title" color="periwinkle">⋯</AppText>
        </Pressable>
      </View>
      <AppText variant="caption" color="textSecondary" style={{ marginBottom: spacing.lg }}>
        {athlete.stroke_type || 'breaststroke'}{athlete.last_tested ? ` · last tested ${athlete.last_tested}` : ''}
      </AppText>

      {editing ? (
        <Card>
          <AppText variant="label" color="textSecondary">Name</AppText>
          <TextInput value={name} onChangeText={setName} style={inputStyle} autoCapitalize="words" />
          <AppText variant="label" color="textSecondary" style={{ marginTop: spacing.md }}>Head-waist distance (m)</AppText>
          <TextInput value={hw} onChangeText={setHw} keyboardType="decimal-pad" style={inputStyle} />
          <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md }}>
            <Button title="Save" onPress={saveEdit} style={{ flex: 1 }} />
            <Button title="Cancel" variant="secondary" onPress={() => setEditing(false)} style={{ flex: 1 }} />
          </View>
        </Card>
      ) : (
        <View style={{ flexDirection: 'row', gap: spacing.sm }}>
          <Button title="Send report" onPress={sendReport} loading={sending} style={{ flex: 1 }} />
          <Button
            title="Record"
            variant="secondary"
            // Nested form is required: this screen is on the Root stack and RecordingConfig is a
            // child of Tabs. navigate() only bubbles UP to parents, never down into a child
            // navigator, so navigate('RecordingConfig') went unhandled and did nothing at all.
            onPress={() => navigation.navigate('Tabs', {
              screen: 'RecordingConfig',
              params: {
                athleteId: athlete.athlete_id, athleteName: athlete.name, defaultStrokeType: athlete.stroke_type,
              },
            })}
            style={{ flex: 1 }}
          />
        </View>
      )}

      <SectionHeader title="Pillars (latest)" />
      {pillars.length ? (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between' }}>
          {pillars.map((p) => {
            const c = BAND_COLOR[p.band] || colors.textMuted;
            return (
              <Card key={p.key} alt style={{ width: '48.5%', marginBottom: spacing.sm }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  <PillarIcon pillarKey={p.key} color={colors.textSecondary} size={14} />
                  <AppText variant="caption" color="textSecondary">{p.label}</AppText>
                </View>
                <AppText variant="body" color={c} style={{ marginTop: 3 }}>{BAND_LABEL[p.band] || '—'}</AppText>
              </Card>
            );
          })}
        </View>
      ) : (
        <AppText variant="body" color="textSecondary">No sessions yet.</AppText>
      )}

      <SectionHeader title="Sessions" />
      {sessions === null ? (
        <ActivityIndicator color={colors.primary} />
      ) : sessions.length === 0 ? (
        <AppText variant="body" color="textSecondary">No sessions recorded.</AppText>
      ) : (
        sessions.map((s, i) => {
          const spm = s.metrics_json?.session?.stroke_rate_spm;
          const date = new Date(s.created_at).toLocaleDateString('en-US', { day: 'numeric', month: 'short' });
          return (
            <Pressable
              key={s.id}
              onPress={() => navigation.navigate('ReportCard', { sessionId: s.id, athleteName: athlete.name, sessionDate: date })}
              style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 11, borderBottomWidth: i < sessions.length - 1 ? 1 : 0, borderBottomColor: colors.border }}
            >
              <AppText variant="body" color="text">{s.name || date}{spm != null ? ` · ${spm.toFixed(1)} spm` : ''}</AppText>
              <AppText variant="body" color="textMuted">›</AppText>
            </Pressable>
          );
        })
      )}
    </Screen>
  );
}

const inputStyle = {
  marginTop: 6,
  backgroundColor: colors.surfaceAlt,
  color: colors.text,
  borderRadius: radii.md,
  paddingHorizontal: 14,
  paddingVertical: 12,
  fontSize: 15,
  borderWidth: 1,
  borderColor: colors.border,
};
