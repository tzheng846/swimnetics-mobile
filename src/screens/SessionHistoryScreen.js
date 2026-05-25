import React, { useCallback, useEffect, useState } from 'react';
import {
  View, Text, FlatList, TouchableOpacity,
  ActivityIndicator, SafeAreaView, StyleSheet,
} from 'react-native';
import { supabase } from '../lib/supabase';

export default function SessionHistoryScreen({ route, navigation }) {
  const { athleteId, athleteName, headWaistM = 0 } = route.params ?? {};
  const [sessions, setSessions] = useState([]);
  const [loading, setLoading]   = useState(true);

  const fetchSessions = useCallback(async () => {
    const { data } = await supabase
      .from('sessions')
      .select('id, created_at, metrics_json')
      .eq('athlete_id', athleteId)
      .order('created_at', { ascending: false });
    setSessions(data ?? []);
    setLoading(false);
  }, [athleteId]);

  useEffect(() => { fetchSessions(); }, [fetchSessions]);

  const renderSession = ({ item }) => {
    const s = item.metrics_json?.session ?? {};
    const date = new Date(item.created_at).toLocaleDateString('en-US', {
      month: 'short', day: 'numeric', year: 'numeric',
    });
    return (
      <TouchableOpacity
        style={st.card}
        onPress={() => navigation.navigate('ReportCard', {
          sessionId: item.id,
          headWaistM,
          athleteName,
          sessionDate: date,
        })}
      >
        <Text style={st.cardDate}>{date}</Text>
        <View style={st.cardRow}>
          <StatItem label="Rate"      value={s.stroke_rate_spm?.toFixed(1)} unit="SPM" />
          <StatItem label="Avg Speed" value={s.mean_vel_ms?.toFixed(2)}     unit="m/s" />
          <StatItem label="Distance"  value={s.total_dist_m?.toFixed(1)}    unit="m"   />
          <StatItem label="Strokes"   value={s.stroke_count}                unit=""    />
        </View>
      </TouchableOpacity>
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
      <Text style={st.sectionLabel}>SESSION HISTORY</Text>
      {loading
        ? <ActivityIndicator color="#2196F3" style={{ marginTop: 40 }} />
        : <FlatList
            data={sessions}
            keyExtractor={i => i.id}
            renderItem={renderSession}
            contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 24 }}
            ListEmptyComponent={<Text style={st.empty}>No sessions recorded yet.</Text>}
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

const st = StyleSheet.create({
  container:    { flex: 1, backgroundColor: '#000' },
  header:       { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, marginTop: 16, marginBottom: 4 },
  back:         { color: '#2196F3', fontSize: 14 },
  title:        { color: '#fff', fontSize: 18, fontWeight: '700' },
  sectionLabel: { color: '#888', fontSize: 12, fontWeight: '600', letterSpacing: 1, marginHorizontal: 20, marginBottom: 10, marginTop: 12 },
  card:         { backgroundColor: '#1a1a1a', borderRadius: 10, padding: 14, marginBottom: 10 },
  cardDate:     { color: '#aaa', fontSize: 12, marginBottom: 8 },
  cardRow:      { flexDirection: 'row', justifyContent: 'space-between' },
  statLabel:    { color: '#666', fontSize: 10, textTransform: 'uppercase', letterSpacing: 0.5 },
  statValue:    { color: '#fff', fontSize: 18, fontWeight: '700', marginTop: 2 },
  statUnit:     { color: '#555', fontSize: 10 },
  empty:        { color: '#555', textAlign: 'center', marginTop: 40 },
});
