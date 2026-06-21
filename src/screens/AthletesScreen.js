import React, { useCallback, useState } from 'react';
import { View, Pressable, ActivityIndicator, TextInput, Alert } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import Screen from '../components/ui/Screen';
import AppText from '../components/ui/AppText';
import Card from '../components/ui/Card';
import Button from '../components/ui/Button';
import { GaugeIcon, RulerIcon, WaveIcon, BatteryIcon } from '../components/ui/PillarIcons';
import { apiFetch } from '../lib/apiFetch';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import { colors, spacing, radii } from '../theme';

const PILLAR_ORDER = ['speed', 'stroke_length', 'consistency', 'endurance'];
const HEADER_ICONS = { speed: GaugeIcon, stroke_length: RulerIcon, consistency: WaveIcon, endurance: BatteryIcon };
// Bands are snake_case (good/ok/needs_work); token keys are camelCase — map explicitly.
const BAND_FALLBACK = { good: colors.good, ok: colors.ok, needs_work: colors.needsWork };

function relTested(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  const days = Math.floor((Date.now() - d.getTime()) / 86400000);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 14) return `${days} days ago`;
  return d.toLocaleDateString('en-US', { day: 'numeric', month: 'short' });
}

export default function AthletesScreen({ navigation }) {
  const { session, teamId } = useAuth();
  const [data, setData] = useState(null);
  const [limit, setLimit] = useState(20);   // swimmer cap; default 20 if the team has none set
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState('');
  const [newHW, setNewHW] = useState('');
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      setError(null);
      const ov = await apiFetch('/team/overview', { token: session?.access_token });
      setData(ov);
      if (teamId) {
        const { data: t } = await supabase.from('teams').select('swimmer_limit').eq('id', teamId).single();
        if (t?.swimmer_limit != null) setLimit(t.swimmer_limit);
      }
    } catch (e) {
      setError(e.message || 'Could not load roster.');
    } finally {
      setLoading(false);
    }
  }, [session, teamId]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const rc = data?.rating_colors || {};
  const athletes = data?.athletes || [];

  const handleAdd = async () => {
    if (!newName.trim()) return;
    setSaving(true);
    const hw = newHW.trim() !== '' ? parseFloat(newHW) : null;
    try {
      await apiFetch('/athletes', {
        token: session?.access_token,
        method: 'POST',
        body: { name: newName.trim(), stroke_type: 'breaststroke', head_waist_m: hw },
      });
      setNewName(''); setNewHW(''); setAdding(false);
      load();
    } catch (e) {
      if (e.status === 402) {
        Alert.alert('Athlete limit reached', (e.message || 'You have reached your athlete limit.') + '\n\nVisit swimnetics.com to upgrade.');
      } else {
        Alert.alert('Error', e.message || 'Failed to add athlete.');
      }
    } finally {
      setSaving(false);
    }
  };

  const bandColor = (band) => rc[band] || BAND_FALLBACK[band] || colors.textMuted;

  const renderRow = (a, i) => {
    const byKey = Object.fromEntries((a.pillars || []).map(p => [p.key, p]));
    const tested = relTested(a.last_tested);
    const hasPillars = (a.pillars || []).length > 0;
    return (
      <Pressable
        key={a.athlete_id}
        onPress={() => navigation.navigate('AthleteDetail', { athlete: a })}
        style={{
          flexDirection: 'row', alignItems: 'center', paddingVertical: 11,
          borderTopWidth: 1, borderTopColor: i === 0 ? colors.border : colors.surfaceAlt,
        }}
      >
        <View style={{ flex: 1.5 }}>
          <AppText variant="body" color="text" numberOfLines={1}>{a.name}</AppText>
          <AppText variant="caption" color={tested ? 'textMuted' : 'needsWork'}>{tested || 'never tested'}</AppText>
        </View>
        {PILLAR_ORDER.map((key) => {
          const p = byKey[key];
          return (
            <View key={key} style={{ flex: 1, alignItems: 'center' }}>
              {hasPillars && p ? (
                <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: bandColor(p.band) }} />
              ) : (
                <AppText variant="caption" color="textMuted">—</AppText>
              )}
            </View>
          );
        })}
      </Pressable>
    );
  };

  return (
    <Screen scroll>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: spacing.md, marginBottom: spacing.xs }}>
        <View>
          <AppText variant="title">Team</AppText>
          {data ? <AppText variant="caption" color="textSecondary">{data.athlete_count} / {limit} swimmers</AppText> : null}
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Add athlete"
          onPress={() => setAdding(v => !v)}
          style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' }}
        >
          <AppText color={colors.white} style={{ fontSize: 22, lineHeight: 24 }}>{adding ? '×' : '+'}</AppText>
        </Pressable>
      </View>

      {adding ? (
        <Card style={{ marginTop: spacing.sm }}>
          <TextInput
            value={newName} onChangeText={setNewName} placeholder="Athlete name" placeholderTextColor={colors.textMuted}
            autoFocus autoCapitalize="words"
            style={{ backgroundColor: colors.surfaceAlt, color: colors.text, borderRadius: radii.md, paddingHorizontal: 14, paddingVertical: 12, fontSize: 15, borderWidth: 1, borderColor: colors.border }}
          />
          <TextInput
            value={newHW} onChangeText={setNewHW} placeholder="Head-waist distance (m), optional" placeholderTextColor={colors.textMuted}
            keyboardType="decimal-pad"
            style={{ marginTop: spacing.sm, backgroundColor: colors.surfaceAlt, color: colors.text, borderRadius: radii.md, paddingHorizontal: 14, paddingVertical: 12, fontSize: 15, borderWidth: 1, borderColor: colors.border }}
          />
          <Button title="Add athlete" onPress={handleAdd} loading={saving} style={{ marginTop: spacing.md }} />
        </Card>
      ) : null}

      {loading ? (
        <ActivityIndicator color={colors.primary} style={{ marginTop: spacing.xxxl }} />
      ) : error ? (
        <Card style={{ marginTop: spacing.xl }}>
          <AppText color="needsWork">{error}</AppText>
          <Pressable onPress={load} style={{ marginTop: spacing.sm }}><AppText color="primary">Tap to retry</AppText></Pressable>
        </Card>
      ) : (
        <View style={{ marginTop: spacing.lg }}>
          {/* Icon header = the pillar legend */}
          <View style={{ flexDirection: 'row', alignItems: 'center', paddingBottom: spacing.xs }}>
            <View style={{ flex: 1.5 }} />
            {PILLAR_ORDER.map((key) => {
              const Icon = HEADER_ICONS[key];
              return <View key={key} style={{ flex: 1, alignItems: 'center' }}><Icon color={colors.textSecondary} size={17} /></View>;
            })}
          </View>

          {athletes.length === 0 ? (
            <AppText variant="body" color="textSecondary" style={{ marginTop: spacing.lg }}>No athletes yet. Tap + to add one.</AppText>
          ) : (
            athletes.map(renderRow)
          )}

          <View style={{ flexDirection: 'row', gap: spacing.lg, marginTop: spacing.lg }}>
            {[['good', 'good'], ['ok', 'ok'], ['needs_work', 'needs work']].map(([band, label]) => (
              <View key={band} style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
                <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: bandColor(band) }} />
                <AppText variant="caption" color="textSecondary">{label}</AppText>
              </View>
            ))}
          </View>
        </View>
      )}
    </Screen>
  );
}
