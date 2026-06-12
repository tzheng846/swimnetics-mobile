import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert, Animated, PanResponder,
  View, Text, FlatList, TouchableOpacity,
  ActivityIndicator, SafeAreaView, StyleSheet,
} from 'react-native';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import { API_BASE } from '../config';

const STROKES = [
  { key: 'all',          label: 'All' },
  { key: 'breaststroke', label: 'Breaststroke' },
  { key: 'freestyle',    label: 'Freestyle' },
  { key: 'backstroke',   label: 'Backstroke' },
  { key: 'butterfly',    label: 'Butterfly' },
  { key: 'im',           label: 'Individual Medley' },
  { key: 'udk',          label: 'Underwater Dolphin Kick' },
];

const STROKE_ABBR = {
  breaststroke: 'Breast', freestyle: 'Free', backstroke: 'Back',
  butterfly: 'Fly', im: 'IM', udk: 'UDK',
};

// ── SwipeableRow ──────────────────────────────────────────────────────────────
// Reveals Star and Delete action buttons on swipe-left.
// Pure RN Animated + PanResponder — no extra packages required.
const SWIPE_THRESHOLD = 80;
const ACTION_WIDTH    = 140;

function SwipeableRow({ children, onStar, onDelete }) {
  const translateX = useRef(new Animated.Value(0)).current;
  const isOpen = useRef(false);

  const close = () => {
    Animated.spring(translateX, { toValue: 0, useNativeDriver: true }).start();
    isOpen.current = false;
  };

  const open = () => {
    Animated.spring(translateX, { toValue: -ACTION_WIDTH, useNativeDriver: true }).start();
    isOpen.current = true;
  };

  const panResponder = useRef(PanResponder.create({
    onMoveShouldSetPanResponder: (_, g) => Math.abs(g.dx) > 6 && Math.abs(g.dx) > Math.abs(g.dy),
    onPanResponderMove: (_, g) => {
      const base = isOpen.current ? -ACTION_WIDTH : 0;
      const next = Math.min(0, Math.max(-ACTION_WIDTH, base + g.dx));
      translateX.setValue(next);
    },
    onPanResponderRelease: (_, g) => {
      // Tap on open card → close
      if (isOpen.current && Math.abs(g.dx) < 5 && Math.abs(g.dy) < 5) {
        close();
        return;
      }
      const base = isOpen.current ? -ACTION_WIDTH : 0;
      const moved = base + g.dx;
      if (moved < -SWIPE_THRESHOLD) {
        open();
      } else {
        close();
      }
    },
    onPanResponderTerminate: (_, g) => {
      const base = isOpen.current ? -ACTION_WIDTH : 0;
      const moved = base + g.dx;
      if (moved < -SWIPE_THRESHOLD) {
        open();
      } else {
        close();
      }
    },
  })).current;

  return (
    <View style={sr.wrap}>
      <View style={sr.actions}>
        <TouchableOpacity style={sr.starBtn} onPress={() => { close(); onStar(); }}>
          <Text style={sr.starBtnText}>★{'\n'}Star</Text>
        </TouchableOpacity>
        <TouchableOpacity style={sr.deleteBtn} onPress={() => { close(); onDelete(); }}>
          <Text style={sr.deleteBtnText}>🗑{'\n'}Delete</Text>
        </TouchableOpacity>
      </View>
      <Animated.View style={{ transform: [{ translateX }] }} {...panResponder.panHandlers}>
        {children}
      </Animated.View>
    </View>
  );
}

// ── Main screen ───────────────────────────────────────────────────────────────
export default function SessionHistoryScreen({ route, navigation }) {
  const { athleteId, athleteName, headWaistM = 0 } = route.params ?? {};
  const { session: authSession } = useAuth();
  const [sessions, setSessions] = useState([]);
  const [loading, setLoading]   = useState(true);
  const [strokeFilter, setStrokeFilter] = useState('all');

  const presentStrokeKeys = useMemo(
    () => new Set(sessions.map(s => s.stroke_type).filter(Boolean)),
    [sessions],
  );
  const visibleStrokes = useMemo(
    () => STROKES.filter(s => s.key === 'all' || presentStrokeKeys.has(s.key)),
    [presentStrokeKeys],
  );

  useEffect(() => {
    if (!loading && strokeFilter !== 'all' && !presentStrokeKeys.has(strokeFilter)) {
      setStrokeFilter('all');
    }
  }, [presentStrokeKeys, strokeFilter, loading]);

  const fetchSessions = useCallback(async () => {
    const { data } = await supabase
      .from('sessions')
      .select('id, created_at, metrics_json, name, is_starred, stroke_type')
      .eq('athlete_id', athleteId)
      .order('created_at', { ascending: false });
    setSessions(data ?? []);
    setLoading(false);
  }, [athleteId]);

  useEffect(() => { fetchSessions(); }, [fetchSessions]);

  // Refetch when returning from ReportCard so star changes are reflected
  useEffect(() => {
    const unsubscribe = navigation.addListener('focus', fetchSessions);
    return unsubscribe;
  }, [navigation, fetchSessions]);

  const authHeader = authSession?.access_token
    ? { Authorization: `Bearer ${authSession.access_token}` }
    : {};

  const handleStar = async (item) => {
    const newVal = !item.is_starred;
    setSessions(prev => prev.map(s => s.id === item.id ? { ...s, is_starred: newVal } : s));
    try {
      await fetch(`${API_BASE}/sessions/${item.id}`, {
        method: 'PATCH',
        headers: { ...authHeader, 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_starred: newVal }),
      });
    } catch {
      setSessions(prev => prev.map(s => s.id === item.id ? { ...s, is_starred: item.is_starred } : s));
    }
  };

  const handleDelete = (item) => {
    Alert.alert(
      'Delete session',
      `Delete this session${item.name ? ` "${item.name}"` : ''}? This cannot be undone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete', style: 'destructive',
          onPress: async () => {
            setSessions(prev => prev.filter(s => s.id !== item.id));
            try {
              await fetch(`${API_BASE}/sessions/${item.id}`, {
                method: 'DELETE',
                headers: authHeader,
              });
            } catch {
              fetchSessions();
            }
          },
        },
      ],
    );
  };

  const displayed = strokeFilter === 'all'
    ? sessions
    : sessions.filter(s => s.stroke_type === strokeFilter);

  const renderSession = ({ item }) => {
    const s = item.metrics_json?.session ?? {};
    const date = new Date(item.created_at).toLocaleDateString('en-US', {
      month: 'short', day: 'numeric', year: 'numeric',
    });
    const abbr = STROKE_ABBR[item.stroke_type] ?? item.stroke_type;

    return (
      <SwipeableRow
        onStar={() => handleStar(item)}
        onDelete={() => handleDelete(item)}
      >
        <TouchableOpacity
          style={st.card}
          onPress={() => navigation.navigate('ReportCard', {
            sessionId: item.id,
            headWaistM,
            athleteName,
            sessionDate: date,
          })}
          activeOpacity={0.8}
        >
          <View style={st.cardHeader}>
            <View style={{ flex: 1 }}>
              {item.name ? <Text style={st.cardName}>{item.name}</Text> : null}
              <Text style={item.name ? st.cardDateSmall : st.cardDate}>{date}</Text>
            </View>
            <View style={st.cardBadges}>
              {item.is_starred ? <Text style={st.starBadge}>★</Text> : null}
              {abbr
                ? <View style={st.strokeBadge}><Text style={st.strokeBadgeText}>{abbr}</Text></View>
                : null}
            </View>
          </View>
          <View style={st.cardRow}>
            <StatItem label="RATE"  value={s.stroke_rate_spm?.toFixed(1)} unit="SPM" />
            <StatItem label="SPEED" value={s.mean_vel_ms?.toFixed(2)}     unit="m/s" />
            <StatItem label="DIST"  value={s.total_dist_m?.toFixed(1)}    unit="m"   />
          </View>
        </TouchableOpacity>
      </SwipeableRow>
    );
  };

  return (
    <SafeAreaView style={st.container}>
      <View style={st.header}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Text style={st.back}>‹ Athletes</Text>
        </TouchableOpacity>
        <Text style={st.title}>{athleteName}</Text>
        <View style={{ width: 60 }} />
      </View>

      {/* Stroke filter chips */}
      <FlatList
        horizontal
        data={visibleStrokes}
        keyExtractor={i => i.key}
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={st.filterRow}
        renderItem={({ item }) => (
          <TouchableOpacity
            style={[st.chip, strokeFilter === item.key && st.chipActive]}
            onPress={() => setStrokeFilter(item.key)}
          >
            <Text style={[st.chipText, strokeFilter === item.key && st.chipTextActive]}>
              {item.label}
            </Text>
          </TouchableOpacity>
        )}
      />

      <Text style={st.sectionLabel}>SESSION HISTORY</Text>

      {loading
        ? <ActivityIndicator color="#2196F3" style={{ marginTop: 40 }} />
        : <FlatList
            data={displayed}
            keyExtractor={i => i.id}
            renderItem={renderSession}
            contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 24 }}
            ListEmptyComponent={
              <Text style={st.empty}>
                {strokeFilter === 'all'
                  ? 'No sessions recorded yet.'
                  : `No ${STROKES.find(s => s.key === strokeFilter)?.label} sessions.`}
              </Text>
            }
          />
      }
    </SafeAreaView>
  );
}

function StatItem({ label, value, unit }) {
  return (
    <View style={{ alignItems: 'center', flex: 1 }}>
      <Text style={st.statLabel}>{label}</Text>
      <Text style={st.statValue}>{value ?? '--'}</Text>
      {unit ? <Text style={st.statUnit}>{unit}</Text> : null}
    </View>
  );
}

// ── Styles ─────────────────────────────────────────────────────────────────────
const sr = StyleSheet.create({
  wrap:          { overflow: 'hidden', marginBottom: 10, borderRadius: 10 },
  actions:       { position: 'absolute', right: 0, top: 0, bottom: 0, flexDirection: 'row', width: ACTION_WIDTH },
  starBtn:       { flex: 1, backgroundColor: '#F39C12', alignItems: 'center', justifyContent: 'center' },
  deleteBtn:     { flex: 1, backgroundColor: '#C0392B', alignItems: 'center', justifyContent: 'center' },
  starBtnText:   { color: '#fff', fontSize: 12, fontWeight: '700', textAlign: 'center' },
  deleteBtnText: { color: '#fff', fontSize: 12, fontWeight: '700', textAlign: 'center' },
});

const st = StyleSheet.create({
  container:      { flex: 1, backgroundColor: '#000' },
  header:         { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, marginTop: 16, marginBottom: 4 },
  back:           { color: '#2196F3', fontSize: 14 },
  title:          { color: '#fff', fontSize: 18, fontWeight: '700' },
  filterRow:      { paddingHorizontal: 20, paddingVertical: 10, gap: 8, alignItems: 'center' },
  chip:           { height: 34, paddingHorizontal: 14, borderRadius: 17, backgroundColor: '#1a1a1a', borderWidth: 1, borderColor: '#333', justifyContent: 'center' },
  chipActive:     { backgroundColor: '#2196F3', borderColor: '#2196F3' },
  chipText:       { color: '#888', fontSize: 13, fontWeight: '500' },
  chipTextActive: { color: '#fff', fontWeight: '600' },
  sectionLabel:   { color: '#888', fontSize: 12, fontWeight: '600', letterSpacing: 1, marginHorizontal: 20, marginBottom: 10, marginTop: 4 },
  card:           { backgroundColor: '#1a1a1a', borderRadius: 10, padding: 14 },
  cardHeader:     { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 10 },
  cardName:       { color: '#fff', fontSize: 15, fontWeight: '600' },
  cardDate:       { color: '#aaa', fontSize: 12 },
  cardDateSmall:  { color: '#666', fontSize: 11, marginTop: 2 },
  cardBadges:     { flexDirection: 'row', alignItems: 'center', gap: 6 },
  starBadge:      { color: '#F39C12', fontSize: 16 },
  strokeBadge:    { backgroundColor: '#1E3A5F', borderRadius: 4, paddingHorizontal: 6, paddingVertical: 2 },
  strokeBadgeText:{ color: '#7FAACC', fontSize: 10, fontWeight: '600' },
  cardRow:        { flexDirection: 'row', justifyContent: 'space-between' },
  statLabel:      { color: '#666', fontSize: 10, textTransform: 'uppercase', letterSpacing: 0.5 },
  statValue:      { color: '#fff', fontSize: 18, fontWeight: '700', marginTop: 2 },
  statUnit:       { color: '#555', fontSize: 10 },
  empty:          { color: '#555', textAlign: 'center', marginTop: 40 },
});
