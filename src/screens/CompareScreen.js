import React, { useEffect, useState } from 'react';
import { View, Pressable, ActivityIndicator } from 'react-native';
import Screen from '../components/ui/Screen';
import AppText from '../components/ui/AppText';
import Card from '../components/ui/Card';
import { PillarIcon } from '../components/ui/PillarIcons';
import { supabase } from '../lib/supabase';
import { apiFetch } from '../lib/apiFetch';
import { useAuth } from '../context/AuthContext';
import { colors, spacing, radii } from '../theme';

const DEADBAND = 5; // score points within which a pillar reads "no change"

function fmt(v) {
  if (v == null) return '--';
  if (typeof v === 'number') return Number.isInteger(v) ? String(v) : v.toFixed(2);
  return String(v);
}

function shortDate(iso) {
  return iso ? new Date(iso).toLocaleDateString('en-US', { day: 'numeric', month: 'short' }) : '';
}

export default function CompareScreen({ route, navigation }) {
  const ids = route.params?.sessionIds || [];
  const { session } = useAuth();
  const [state, setState] = useState(null); // { a, b, sameAthlete, rows } | { error }
  const [open, setOpen] = useState(null);   // expanded pillar key

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        if (ids.length !== 2) throw new Error('Pick two sessions to compare.');
        const { data: metas } = await supabase
          .from('sessions')
          .select('id, created_at, athlete_id, stroke_type, athletes(name)')
          .in('id', ids);
        if (!metas || metas.length !== 2) throw new Error('Sessions not found.');
        const ordered = [...metas].sort((m, n) => new Date(m.created_at) - new Date(n.created_at));
        const [a, b] = ordered;
        const [rA, rB] = await Promise.all(
          [a.id, b.id].map(id => apiFetch(`/sessions/${id}/ratings`, { token: session?.access_token })),
        );
        const byKeyB = Object.fromEntries((rB.pillars || []).map(p => [p.key, p]));
        const rows = (rA.pillars || []).map(pA => ({ key: pA.key, label: pA.label, a: pA, b: byKeyB[pA.key] }));
        if (active) setState({ a, b, sameAthlete: a.athlete_id === b.athlete_id, rows });
      } catch (e) {
        if (active) setState({ error: e.message || 'Could not load comparison.' });
      }
    })();
    return () => { active = false; };
  }, [route.params, session]);

  const labels = (sameAthlete) => sameAthlete
    ? { better: '↑ Better', worse: '↓ Worse', none: '→ No change' }
    : { better: '↑ Higher', worse: '↓ Lower', none: '= Even' };

  const verdict = (a, b, sameAthlete) => {
    const L = labels(sameAthlete);
    if (!a || !b || a.score == null || b.score == null) {
      return { text: '—', fg: colors.textMuted, bg: colors.surfaceAlt };
    }
    const d = b.score - a.score;
    if (d > DEADBAND) return { text: L.better, fg: colors.good, bg: colors.goodBg };
    if (d < -DEADBAND) return { text: L.worse, fg: colors.needsWork, bg: colors.needsWorkBg };
    return { text: L.none, fg: colors.textSecondary, bg: colors.surfaceAlt };
  };

  return (
    <Screen scroll>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: spacing.md, marginBottom: spacing.lg }}>
        <Pressable onPress={() => navigation.goBack()} accessibilityLabel="Back" hitSlop={10}>
          <AppText variant="title" color="text">‹</AppText>
        </Pressable>
        <AppText variant="title">Compare</AppText>
      </View>

      {!state ? (
        <ActivityIndicator color={colors.primary} style={{ marginTop: spacing.xxxl }} />
      ) : state.error ? (
        <Card><AppText color="needsWork">{state.error}</AppText></Card>
      ) : (
        <>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.lg }}>
            <Card alt style={{ flex: 1 }} padded={false}>
              <View style={{ padding: spacing.md }}>
                <AppText variant="caption" color="textMuted">earlier</AppText>
                <AppText variant="label" color="text" numberOfLines={1}>{state.a.athletes?.name} · {shortDate(state.a.created_at)}</AppText>
              </View>
            </Card>
            <AppText color="periwinkle">→</AppText>
            <Card alt style={{ flex: 1 }} padded={false}>
              <View style={{ padding: spacing.md }}>
                <AppText variant="caption" color="textMuted">later</AppText>
                <AppText variant="label" color="text" numberOfLines={1}>{state.b.athletes?.name} · {shortDate(state.b.created_at)}</AppText>
              </View>
            </Card>
          </View>

          {(() => {
            const tally = state.rows.reduce((acc, r) => {
              const v = verdict(r.a, r.b, state.sameAthlete).text;
              if (v.startsWith('↑')) acc.up += 1; else if (v.startsWith('↓')) acc.down += 1; else if (v !== '—') acc.same += 1;
              return acc;
            }, { up: 0, same: 0, down: 0 });
            const upWord = state.sameAthlete ? 'better' : 'higher';
            const downWord = state.sameAthlete ? 'worse' : 'lower';
            return (
              <AppText variant="body" color="text" style={{ marginBottom: spacing.md }}>
                {tally.up} {upWord} · {tally.same} {state.sameAthlete ? 'no change' : 'even'} · {tally.down} {downWord}
              </AppText>
            );
          })()}

          <Card padded={false}>
            {state.rows.map((r, i) => {
              const v = verdict(r.a, r.b, state.sameAthlete);
              const expanded = open === r.key;
              const pa = r.a?.primary, pb = r.b?.primary;
              return (
                <Pressable
                  key={r.key}
                  onPress={() => setOpen(expanded ? null : r.key)}
                  style={{ paddingVertical: 13, paddingHorizontal: spacing.md, borderBottomWidth: i < state.rows.length - 1 ? 1 : 0, borderBottomColor: colors.border }}
                >
                  <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                      <PillarIcon pillarKey={r.key} color={colors.textSecondary} size={16} />
                      <AppText variant="body" color="textSecondary">{r.label}</AppText>
                    </View>
                    <View style={{ backgroundColor: v.bg, borderRadius: radii.sm, paddingHorizontal: 10, paddingVertical: 4 }}>
                      <AppText variant="caption" color={v.fg}>{v.text}</AppText>
                    </View>
                  </View>
                  {expanded && pa && pb ? (
                    <AppText variant="caption" color="textMuted" style={{ marginTop: 8 }}>
                      {pa.label}: {fmt(pa.value)}{pa.unit ? ` ${pa.unit}` : ''} → {fmt(pb.value)}{pb.unit ? ` ${pb.unit}` : ''}
                    </AppText>
                  ) : null}
                </Pressable>
              );
            })}
          </Card>

          <AppText variant="caption" color="textMuted" style={{ textAlign: 'center', marginTop: spacing.md }}>tap a pillar to see the numbers</AppText>
        </>
      )}
    </Screen>
  );
}
