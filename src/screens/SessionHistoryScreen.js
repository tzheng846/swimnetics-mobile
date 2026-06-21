import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, FlatList, Pressable, ActivityIndicator, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import AppText from '../components/ui/AppText';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import { API_BASE } from '../config';
import { colors, spacing, radii } from '../theme';

const STROKES = [
  { key: 'all', label: 'All' },
  { key: 'breaststroke', label: 'Breast' },
  { key: 'freestyle', label: 'Free' },
  { key: 'backstroke', label: 'Back' },
  { key: 'butterfly', label: 'Fly' },
  { key: 'im', label: 'IM' },
  { key: 'udk', label: 'UDK' },
];
const STROKE_ABBR = { breaststroke: 'breaststroke', freestyle: 'freestyle', backstroke: 'backstroke', butterfly: 'butterfly', im: 'IM', udk: 'UDK' };

export default function SessionHistoryScreen({ route, navigation }) {
  const { athleteId, athleteName } = route.params ?? {};
  const { session: authSession } = useAuth();
  const [sessions, setSessions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [strokeFilter, setStrokeFilter] = useState('all');
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState([]); // up to 2 session ids

  const authHeader = authSession?.access_token ? { Authorization: `Bearer ${authSession.access_token}` } : {};

  const fetchSessions = useCallback(async () => {
    let q = supabase
      .from('sessions')
      .select('id, created_at, name, is_starred, stroke_type, metrics_json, athlete_id, athletes(name)')
      .order('created_at', { ascending: false });
    if (athleteId) q = q.eq('athlete_id', athleteId);
    const { data } = await q;
    setSessions(data ?? []);
    setLoading(false);
  }, [athleteId]);

  useEffect(() => { fetchSessions(); }, [fetchSessions]);
  useEffect(() => navigation.addListener('focus', fetchSessions), [navigation, fetchSessions]);

  const presentStrokes = useMemo(() => new Set(sessions.map(s => s.stroke_type).filter(Boolean)), [sessions]);
  const visibleStrokes = useMemo(() => STROKES.filter(s => s.key === 'all' || presentStrokes.has(s.key)), [presentStrokes]);
  const displayed = strokeFilter === 'all' ? sessions : sessions.filter(s => s.stroke_type === strokeFilter);

  const handleStar = async (item) => {
    const newVal = !item.is_starred;
    setSessions(prev => prev.map(s => s.id === item.id ? { ...s, is_starred: newVal } : s));
    try {
      await fetch(`${API_BASE}/sessions/${item.id}`, { method: 'PATCH', headers: { ...authHeader, 'Content-Type': 'application/json' }, body: JSON.stringify({ is_starred: newVal }) });
    } catch { setSessions(prev => prev.map(s => s.id === item.id ? { ...s, is_starred: item.is_starred } : s)); }
  };

  const toggleSelect = (id) => {
    setSelected(prev => {
      if (prev.includes(id)) return prev.filter(x => x !== id);
      if (prev.length >= 2) return prev; // cap at 2
      return [...prev, id];
    });
  };

  const exitCompare = () => { setSelectMode(false); setSelected([]); };
  const startCompare = () => {
    if (selected.length === 2) navigation.navigate('Compare', { sessionIds: selected });
  };

  const renderRow = ({ item }) => {
    const s = item.metrics_json?.session ?? {};
    const date = new Date(item.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    const name = item.athletes?.name || athleteName || 'Swimmer';
    const spm = s.stroke_rate_spm;
    const sub = `${date} · ${STROKE_ABBR[item.stroke_type] ?? item.stroke_type}${spm != null ? ` · ${spm.toFixed(0)} spm` : ''}`;
    const checked = selected.includes(item.id);

    return (
      <View style={st.card}>
        <Pressable
          style={st.cardMain}
          onPress={() => selectMode
            ? toggleSelect(item.id)
            : navigation.navigate('ReportCard', { sessionId: item.id, athleteName: name, sessionDate: date })}
        >
          {selectMode ? (
            <View style={[st.checkbox, checked && st.checkboxOn]}>{checked ? <AppText color={colors.white} style={{ fontSize: 12 }}>✓</AppText> : null}</View>
          ) : null}
          <View style={{ flex: 1 }}>
            <AppText variant="body" color="text" numberOfLines={1}>{name}</AppText>
            <AppText variant="caption" color="textMuted">{sub}</AppText>
          </View>
        </Pressable>
        {!selectMode ? (
          <Pressable onPress={() => handleStar(item)} hitSlop={10} accessibilityLabel={item.is_starred ? 'Unstar session' : 'Star session'} style={st.starBtn}>
            <AppText color={item.is_starred ? 'ok' : 'textMuted'} style={{ fontSize: 18 }}>{item.is_starred ? '★' : '☆'}</AppText>
          </Pressable>
        ) : null}
      </View>
    );
  };

  return (
    <SafeAreaView edges={['top']} style={{ flex: 1, backgroundColor: colors.bg }}>
      <View style={st.header}>
        <AppText variant="title">{athleteName ? `${athleteName}` : 'History'}</AppText>
        {selectMode ? (
          <Pressable onPress={exitCompare}><AppText variant="body" color="textSecondary">Cancel</AppText></Pressable>
        ) : (
          <Pressable onPress={() => setSelectMode(true)}><AppText variant="body" color="primary">Compare</AppText></Pressable>
        )}
      </View>

      <FlatList
        horizontal
        data={visibleStrokes}
        keyExtractor={i => i.key}
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={st.filterRow}
        renderItem={({ item }) => {
          const on = strokeFilter === item.key;
          return (
            <Pressable onPress={() => setStrokeFilter(item.key)} style={[st.chip, on && st.chipOn]}>
              <AppText variant="label" color={on ? colors.white : 'textSecondary'}>{item.label}</AppText>
            </Pressable>
          );
        }}
        style={{ flexGrow: 0 }}
      />

      {loading ? (
        <ActivityIndicator color={colors.primary} style={{ marginTop: spacing.xxxl }} />
      ) : (
        <FlatList
          data={displayed}
          keyExtractor={i => i.id}
          renderItem={renderRow}
          contentContainerStyle={{ paddingHorizontal: spacing.lg, paddingBottom: selectMode ? 90 : 24 }}
          ListEmptyComponent={<AppText variant="body" color="textSecondary" style={{ textAlign: 'center', marginTop: spacing.xxxl }}>No sessions yet.</AppText>}
        />
      )}

      {selectMode ? (
        <View style={st.compareBar}>
          <Pressable
            onPress={startCompare}
            disabled={selected.length !== 2}
            style={[st.compareBtn, { opacity: selected.length === 2 ? 1 : 0.5 }]}
          >
            <AppText color={colors.white} weight="600">
              {selected.length === 2 ? 'Compare' : `Pick ${2 - selected.length} more`}
            </AppText>
          </Pressable>
        </View>
      ) : null}
    </SafeAreaView>
  );
}

const st = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing.lg, marginTop: spacing.md, marginBottom: spacing.xs },
  filterRow: { paddingHorizontal: spacing.lg, paddingVertical: spacing.sm, gap: 8, alignItems: 'center' },
  chip: { height: 32, paddingHorizontal: 14, borderRadius: radii.pill, backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: colors.border, justifyContent: 'center' },
  chipOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  card: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radii.md, paddingVertical: 12, paddingHorizontal: 14, marginBottom: 8 },
  cardMain: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 12 },
  starBtn: { paddingLeft: 12, paddingVertical: 4 },
  checkbox: { width: 20, height: 20, borderRadius: 5, borderWidth: 2, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
  checkboxOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  compareBar: { position: 'absolute', left: 0, right: 0, bottom: 0, padding: spacing.lg, backgroundColor: colors.surface, borderTopWidth: 1, borderTopColor: colors.border },
  compareBtn: { backgroundColor: colors.primary, borderRadius: radii.md, paddingVertical: 14, alignItems: 'center' },
});
