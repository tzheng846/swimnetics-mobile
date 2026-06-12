import React, { useCallback, useEffect, useState } from 'react';
import {
  View, Text, TouchableOpacity, FlatList,
  ActivityIndicator, SafeAreaView, StyleSheet,
  TextInput, KeyboardAvoidingView, Platform, Alert,
} from 'react-native';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import { API_BASE } from '../config';

const AVATAR_COLORS = ['#2563EB', '#7C3AED', '#0891B2', '#059669', '#D97706', '#DC2626'];
function avatarColor(name) {
  const code = (name?.charCodeAt(0) ?? 65) - 65;
  return AVATAR_COLORS[Math.abs(code) % AVATAR_COLORS.length];
}

export default function AthletesScreen({ navigation }) {
  const { teamId, signOut, session } = useAuth();
  const [athletes, setAthletes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState('');
  const [newHW, setNewHW] = useState('');
  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [editHW, setEditHW] = useState('');
  const [lastSessions, setLastSessions] = useState({});

  const fetchAthletes = useCallback(async () => {
    const { data } = await supabase
      .from('athletes')
      .select('id, name, stroke_type, head_waist_m')
      .order('name');
    setAthletes(data ?? []);

    const ids = (data ?? []).map(a => a.id);
    if (ids.length > 0) {
      const { data: sessions } = await supabase
        .from('sessions')
        .select('athlete_id, created_at, metrics_json')
        .in('athlete_id', ids)
        .order('created_at', { ascending: false });
      const latest = {};
      for (const s of sessions ?? []) {
        if (!latest[s.athlete_id]) latest[s.athlete_id] = s;
      }
      setLastSessions(latest);
    }

    setLoading(false);
  }, []);

  useEffect(() => { fetchAthletes(); }, [fetchAthletes]);

  const handleAdd = async () => {
    if (!newName.trim()) return;
    setSaving(true);
    const hw = newHW.trim() !== '' ? parseFloat(newHW) : null;
    try {
      const resp = await fetch(`${API_BASE}/athletes`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session?.access_token}`,
        },
        body: JSON.stringify({ name: newName.trim(), stroke_type: 'breaststroke', head_waist_m: hw }),
      });
      if (resp.status === 402) {
        const body = await resp.json().catch(() => ({}));
        Alert.alert(
          'Athlete Limit Reached',
          (body.detail || 'You have reached your athlete limit.') + '\n\nVisit swimnetics.com to upgrade.',
          [{ text: 'OK' }],
        );
        return;
      }
      if (!resp.ok) {
        const body = await resp.json().catch(() => ({}));
        Alert.alert('Error', body.detail || 'Failed to add athlete.');
        return;
      }
      const inserted = await resp.json();
      setAthletes(prev =>
        [...prev, inserted].sort((a, b) => a.name.localeCompare(b.name))
      );
      setNewName('');
      setNewHW('');
      setAdding(false);
    } catch (e) {
      Alert.alert('Error', e.message || 'Failed to add athlete.');
    } finally {
      setSaving(false);
    }
  };

  const handleEditHW = async (id) => {
    const hw = editHW.trim() !== '' ? parseFloat(editHW) : null;
    const { error } = await supabase
      .from('athletes')
      .update({ head_waist_m: hw })
      .eq('id', id);
    if (!error) {
      setAthletes(prev => prev.map(a => a.id === id ? { ...a, head_waist_m: hw } : a));
    }
    setEditingId(null);
    setEditHW('');
  };

  const renderAthlete = ({ item }) => {
    const ls = lastSessions[item.id];
    const lsText = ls
      ? `${new Date(ls.created_at).toLocaleDateString('en-US', { day: 'numeric', month: 'short' })} · ${ls.metrics_json?.session?.stroke_rate_spm?.toFixed(1)} SPM`
      : 'No sessions yet';
    return (
      <View style={s.card}>
        <TouchableOpacity
          style={s.cardMain}
          onPress={() => navigation.navigate('RecordingConfig', {
            athleteId: item.id,
            athleteName: item.name,
            defaultStrokeType: item.stroke_type,
            headWaistM: item.head_waist_m ?? 0,
          })}
        >
          <View style={[s.avatar, { backgroundColor: avatarColor(item.name) }]}>
            <Text style={s.avatarText}>{item.name?.[0]?.toUpperCase() ?? '?'}</Text>
          </View>
          <View style={s.cardBody}>
            <Text style={s.cardName}>{item.name}</Text>
            <Text style={s.cardStroke}>{item.stroke_type}</Text>
            <Text style={s.cardLastSession}>{lsText}</Text>
          </View>
          <Text style={s.cardArrow}>›</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={s.historyBtn}
          onPress={() => navigation.navigate('SessionHistory', {
            athleteId: item.id,
            athleteName: item.name,
            headWaistM: item.head_waist_m ?? 0,
          })}
        >
          <Text style={s.historyBtnText}>History ›</Text>
        </TouchableOpacity>
      </View>
    );
  };

  return (
    <SafeAreaView style={s.container}>
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <View style={s.header}>
        <Text style={s.title}>Swimnetics</Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <TouchableOpacity onPress={() => navigation.navigate('Devices')} style={s.gearBtn}>
            <Text style={s.gearText}>⚙</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={signOut}>
            <Text style={s.signOut}>Sign Out</Text>
          </TouchableOpacity>
        </View>
      </View>

      <Text style={s.sectionLabel}>ATHLETES</Text>

      {loading ? (
        <ActivityIndicator color="#2196F3" style={{ marginTop: 40 }} />
      ) : (
        <FlatList
          data={athletes}
          keyExtractor={a => a.id}
          renderItem={renderAthlete}
          contentContainerStyle={{ paddingHorizontal: 20 }}
          ListEmptyComponent={
            <Text style={s.empty}>No athletes yet. Add one below.</Text>
          }
        />
      )}

      {adding ? (
        <View style={s.addForm}>
          <TextInput
            style={s.input}
            placeholder="Athlete name"
            placeholderTextColor="#666"
            value={newName}
            onChangeText={setNewName}
            autoFocus
            autoCapitalize="words"
          />
          <TextInput
            style={s.input}
            placeholder="Head-waist distance (m), e.g. 0.35"
            placeholderTextColor="#666"
            value={newHW}
            onChangeText={setNewHW}
            keyboardType="decimal-pad"
          />
          <View style={s.addButtons}>
            <TouchableOpacity
              style={[s.btn, s.btnPrimary, saving && s.btnDisabled]}
              onPress={handleAdd}
              disabled={saving}
            >
              {saving
                ? <ActivityIndicator color="#fff" />
                : <Text style={s.btnText}>Save</Text>
              }
            </TouchableOpacity>
            <TouchableOpacity
              style={[s.btn, s.btnSecondary]}
              onPress={() => { setAdding(false); setNewName(''); setNewHW(''); }}
            >
              <Text style={[s.btnText, { color: '#888' }]}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      ) : (
        <TouchableOpacity style={s.addBtn} onPress={() => setAdding(true)}>
          <Text style={s.addBtnText}>+ Add Athlete</Text>
        </TouchableOpacity>
      )}
    </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  container:     { flex: 1, backgroundColor: '#000' },
  header:        { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, marginTop: 16, marginBottom: 4 },
  title:         { color: '#fff', fontSize: 22, fontWeight: '700' },
  signOut:       { color: '#888', fontSize: 13 },
  gearBtn:       { paddingHorizontal: 4 },
  gearText:      { color: '#888', fontSize: 18 },
  sectionLabel:  { color: '#888', fontSize: 12, fontWeight: '600', letterSpacing: 1, marginHorizontal: 20, marginBottom: 10, marginTop: 12 },
  empty:         { color: '#555', textAlign: 'center', marginTop: 40 },
  card:          { backgroundColor: '#1a1a1a', borderRadius: 10, marginBottom: 10, overflow: 'hidden' },
  cardMain:      { padding: 16, flexDirection: 'row', alignItems: 'center', gap: 12 },
  avatar:        { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  avatarText:    { color: '#fff', fontSize: 16, fontWeight: '700' },
  cardBody:      { flex: 1 },
  cardName:      { color: '#fff', fontSize: 17, fontWeight: '600' },
  cardStroke:    { color: '#888', fontSize: 13, marginTop: 2 },
  cardLastSession: { color: '#555', fontSize: 11, marginTop: 2 },
  cardArrow:       { color: '#555', fontSize: 24 },
  editRow:       { flexDirection: 'row', alignItems: 'center', marginTop: 6, gap: 8 },
  editInput:     { flex: 1, backgroundColor: '#2a2a2a', color: '#fff', borderRadius: 6, paddingHorizontal: 10, paddingVertical: 6, fontSize: 14, borderWidth: 1, borderColor: '#444' },
  editSaveBtn:   { backgroundColor: '#2196F3', borderRadius: 6, paddingHorizontal: 12, paddingVertical: 6 },
  editSaveBtnText:{ color: '#fff', fontSize: 13, fontWeight: '600' },
  editCancelText:{ color: '#555', fontSize: 18, paddingHorizontal: 4 },
  editOffsetBtn:  { borderTopWidth: 1, borderTopColor: '#2a2a2a', paddingVertical: 8, alignItems: 'center' },
  editOffsetText: { color: '#444', fontSize: 12 },
  historyBtn:     { borderTopWidth: 1, borderTopColor: '#2a2a2a', paddingVertical: 8, alignItems: 'center' },
  historyBtnText: { color: '#2196F3', fontSize: 12, fontWeight: '600' },
  addForm:       { padding: 20, borderTopWidth: 1, borderTopColor: '#1a1a1a' },
  input:         { backgroundColor: '#1a1a1a', color: '#fff', borderRadius: 8, paddingHorizontal: 16, paddingVertical: 12, fontSize: 16, marginBottom: 10, borderWidth: 1, borderColor: '#333' },
  addButtons:    { flexDirection: 'row', gap: 10 },
  btn:           { flex: 1, borderRadius: 8, paddingVertical: 12, alignItems: 'center' },
  btnPrimary:    { backgroundColor: '#2196F3' },
  btnSecondary:  { backgroundColor: '#1a1a1a', borderWidth: 1, borderColor: '#333' },
  btnDisabled:   { opacity: 0.6 },
  btnText:       { color: '#fff', fontWeight: '600', fontSize: 15 },
  addBtn:        { margin: 20, backgroundColor: '#1a1a1a', borderRadius: 10, padding: 16, alignItems: 'center', borderWidth: 1, borderColor: '#333' },
  addBtnText:    { color: '#2196F3', fontSize: 16, fontWeight: '600' },
});
