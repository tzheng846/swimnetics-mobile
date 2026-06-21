import React, { useEffect, useState } from 'react';
import { View, Pressable, TextInput } from 'react-native';
import Screen from '../components/ui/Screen';
import AppText from '../components/ui/AppText';
import Card from '../components/ui/Card';
import Button from '../components/ui/Button';
import SectionHeader from '../components/ui/SectionHeader';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import { useUnits } from '../context/UnitsContext';
import { colors, spacing, radii } from '../theme';

function Row({ children, last }) {
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingVertical: 13,
        paddingHorizontal: spacing.md,
        borderBottomWidth: last ? 0 : 1,
        borderBottomColor: colors.border,
      }}
    >
      {children}
    </View>
  );
}

function NavRow({ label, onPress, last }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button">
      <Row last={last}>
        <AppText variant="body" color="text">{label}</AppText>
        <AppText variant="body" color="textMuted">›</AppText>
      </Row>
    </Pressable>
  );
}

export default function SettingsScreen({ navigation }) {
  const { session, teamId, signOut } = useAuth();
  const [teamName, setTeamName] = useState('');
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const { unit, setUnit } = useUnits();

  useEffect(() => {
    if (!teamId) return;
    supabase.from('teams').select('name').eq('id', teamId).single()
      .then(({ data }) => { if (data?.name) { setTeamName(data.name); setDraft(data.name); } });
  }, [teamId]);

  const saveName = async () => {
    const name = draft.trim();
    if (!name) { setEditing(false); return; }
    const { error } = await supabase.from('teams').update({ name }).eq('id', teamId);
    if (!error) setTeamName(name);
    setEditing(false);
  };

  return (
    <Screen scroll>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: spacing.md, marginBottom: spacing.sm }}>
        <Pressable onPress={() => navigation.goBack()} accessibilityRole="button" accessibilityLabel="Back" hitSlop={10}>
          <AppText variant="title" color="text">‹</AppText>
        </Pressable>
        <AppText variant="title">Settings</AppText>
      </View>

      <SectionHeader title="Account" />
      <Card padded={false}>
        <Row>
          <AppText variant="body" color="textSecondary">Team name</AppText>
          {editing ? (
            <TextInput
              value={draft}
              onChangeText={setDraft}
              onBlur={saveName}
              onSubmitEditing={saveName}
              autoFocus
              style={{ flex: 1, marginLeft: spacing.md, textAlign: 'right', color: colors.text, fontSize: 15, padding: 0 }}
            />
          ) : (
            <Pressable onPress={() => setEditing(true)} style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <AppText variant="body" color="text">{teamName || 'Set name'}</AppText>
              <AppText variant="caption" color="periwinkle">edit</AppText>
            </Pressable>
          )}
        </Row>
        <Row last>
          <AppText variant="body" color="textSecondary">Coach</AppText>
          <AppText variant="body" color="text" numberOfLines={1}>{session?.user?.email || '—'}</AppText>
        </Row>
      </Card>

      <SectionHeader title="Device" />
      <Card padded={false}>
        <NavRow label="Manage devices" onPress={() => navigation.navigate('Devices')} />
        <NavRow label="Diagnostics" onPress={() => navigation.navigate('Diagnostics')} last />
      </Card>

      <SectionHeader title="Preferences" />
      <Card padded={false}>
        <Row last>
          <AppText variant="body" color="text">Units</AppText>
          <View style={{ flexDirection: 'row', borderWidth: 1, borderColor: colors.border, borderRadius: radii.sm, overflow: 'hidden' }}>
            {['m', 'yd'].map((u) => {
              const on = unit === u;
              return (
                <Pressable key={u} onPress={() => setUnit(u)} style={{ paddingVertical: 5, paddingHorizontal: 14, backgroundColor: on ? colors.primary : colors.surface }}>
                  <AppText variant="label" color={on ? colors.white : 'textSecondary'}>{u}</AppText>
                </Pressable>
              );
            })}
          </View>
        </Row>
      </Card>

      <Button title="Sign out" variant="danger" onPress={signOut} style={{ marginTop: spacing.xxl }} />
    </Screen>
  );
}
