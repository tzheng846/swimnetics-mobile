import React, { useCallback, useState, useMemo, useEffect } from 'react';
import { View, Pressable, ActivityIndicator } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import * as SecureStore from 'expo-secure-store';
import Screen from '../components/ui/Screen';
import AppText from '../components/ui/AppText';
import Card from '../components/ui/Card';
import SectionHeader from '../components/ui/SectionHeader';
import { SettingsIcon } from '../components/ui/TabIcons';
import { PillarIcon } from '../components/ui/PillarIcons';
import BandDot from '../components/ui/BandDot';
import AiBubble from '../components/ai/AiBubble';
import { supabase } from '../lib/supabase';
import { apiFetch } from '../lib/apiFetch';
import { useAuth } from '../context/AuthContext';
import { bandColor } from '../lib/indicators';
import { colors, spacing, radii } from '../theme';

const TIP_PROMPT =
  'In one or two short sentences, what should the team focus on in practice today? ' +
  'Be specific and ground it in the data. No greeting, no preamble.';

function greeting() {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning, coach';
  if (h < 18) return 'Good afternoon, coach';
  return 'Good evening, coach';
}

function relDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const days = Math.floor((Date.now() - d.getTime()) / 86400000);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 7) return `${days}d ago`;
  return d.toLocaleDateString('en-US', { day: 'numeric', month: 'short' });
}

function overallScore(pillars) {
  const s = (pillars || []).filter(p => !p.provisional && p.score != null).map(p => p.score);
  return s.length ? Math.round(s.reduce((a, b) => a + b, 0) / s.length) : null;
}

const SEVERITY = { needs_work: 0, declined: 1, stale: 2, never_tested: 3 };
function primaryReason(reasons) {
  return [...(reasons || [])].sort((a, b) => SEVERITY[a.type] - SEVERITY[b.type])[0];
}

export default function DashboardScreen({ navigation }) {
  const { session, teamId } = useAuth();
  const [data, setData] = useState(null);
  const [teamName, setTeamName] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [tip, setTip] = useState(null);
  const [chatOpen, setChatOpen] = useState(false);

  const anchorSessionId = data?.recent?.[0]?.session_id || null;

  const load = useCallback(async () => {
    try {
      setError(null);
      const ov = await apiFetch('/team/overview', { token: session?.access_token });
      setData(ov);
    } catch (e) {
      setError(e.message || 'Could not load team.');
    } finally {
      setLoading(false);
    }
  }, [session]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  useFocusEffect(useCallback(() => {
    let active = true;
    if (teamId) {
      supabase.from('teams').select('name').eq('id', teamId).single()
        .then(({ data: t }) => { if (active && t?.name) setTeamName(t.name); });
    }
    return () => { active = false; };
  }, [teamId]));

  // Today's-focus tip: generated at most once per day per team (cached in SecureStore).
  useEffect(() => {
    if (!anchorSessionId || !teamId) return;
    let active = true;
    const key = `dailyTip:${teamId}:${new Date().toISOString().slice(0, 10)}`;
    (async () => {
      try {
        const cached = await SecureStore.getItemAsync(key);
        if (cached) { if (active) setTip(cached); return; }
        const res = await apiFetch('/coach/chat', {
          token: session?.access_token,
          method: 'POST',
          body: { session_id: anchorSessionId, messages: [{ role: 'user', content: TIP_PROMPT }] },
        });
        const reply = (res?.reply || '').trim();
        if (reply && active) { setTip(reply); SecureStore.setItemAsync(key, reply).catch(() => {}); }
      } catch {
        // AI unavailable (e.g. ANTHROPIC unset → 503): silently skip the card, don't break the dashboard.
      }
    })();
    return () => { active = false; };
  }, [anchorSessionId, teamId, session]);

  const athleteMap = useMemo(
    () => Object.fromEntries((data?.athletes || []).map(a => [a.athlete_id, a])),
    [data],
  );
  // Straight through to bandColor(), which is total — the old `|| colors` fallback mixed the
  // snake_case band keys with the camelCase token keys and only worked by key-name coincidence.
  const rc = data?.rating_colors;

  const renderNeedsCard = (n) => {
    const summary = athleteMap[n.athlete_id];
    const pillars = summary?.pillars || [];
    const score = overallScore(pillars);
    const r = primaryReason(n.reasons);

    let chipColor = colors.textSecondary;
    let chipText = '';
    let pillarKey = null;
    if (r?.type === 'needs_work') {
      chipColor = bandColor('needs_work', rc);
      chipText = `${r.pillar} needs work`;
      pillarKey = pillars.find(p => p.label === r.pillar)?.key;
    } else if (r?.type === 'declined') {
      chipColor = bandColor('ok', rc);
      chipText = `${r.pillar} declined`;
      pillarKey = pillars.find(p => p.label === r.pillar)?.key;
    } else if (r?.type === 'stale') {
      chipText = `Stale ${r.days}d`;
    } else {
      chipText = 'Never tested';
    }

    return (
      <Card key={n.athlete_id} alt style={{ width: '48.5%', marginBottom: spacing.sm }} padded={false}>
        <View style={{ padding: spacing.md }}>
          <AppText variant="label" color="text" numberOfLines={1}>{n.name}</AppText>
          {/* Bands lead, the same BandDot the roster draws, in ratings.PILLARS order (which is the
              roster's column order). The 0-100 roll-up is secondary — see 84-03 decision A. */}
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 8 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              {pillars.length ? (
                pillars.map(p => <BandDot key={p.key} band={p.band} provisional={p.provisional} ratingColors={rc} />)
              ) : (
                <AppText variant="caption" color="textMuted">—</AppText>
              )}
            </View>
            {score != null ? <AppText variant="caption" color="textSecondary">{score}</AppText> : null}
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 7 }}>
            {pillarKey ? <PillarIcon pillarKey={pillarKey} color={chipColor} size={13} /> : null}
            <AppText variant="caption" color={chipColor}>{chipText}</AppText>
          </View>
        </View>
      </Card>
    );
  };

  return (
    <View style={{ flex: 1 }}>
    <Screen scroll>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: spacing.md }}>
        <View style={{ flex: 1 }}>
          <AppText variant="caption" color="periwinkle">{greeting()}</AppText>
          <AppText variant="title" style={{ marginTop: 2 }} numberOfLines={1}>{teamName || 'Your team'}</AppText>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Settings"
          onPress={() => navigation.navigate('Settings')}
          style={{ width: 38, height: 38, borderRadius: 19, backgroundColor: colors.surfaceAlt, alignItems: 'center', justifyContent: 'center' }}
        >
          <SettingsIcon color={colors.primary} size={20} />
        </Pressable>
      </View>

      {tip ? (
        <Pressable
          onPress={() => setChatOpen(true)}
          accessibilityRole="button"
          accessibilityLabel="Today's focus — open coach AI"
          style={{ marginTop: spacing.lg, backgroundColor: colors.accentBg, borderWidth: 1, borderColor: colors.accentBorder, borderRadius: radii.lg, padding: spacing.md }}
        >
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 3 }}>
            <AppText variant="caption" color="accentText">✦ Today's focus</AppText>
            <AppText variant="caption" color="accentText">ask ›</AppText>
          </View>
          <AppText variant="body" color="accentText" style={{ lineHeight: 20 }}>{tip}</AppText>
        </Pressable>
      ) : null}

      {loading ? (
        <ActivityIndicator color={colors.primary} style={{ marginTop: spacing.xxxl }} />
      ) : error ? (
        <Card style={{ marginTop: spacing.xl }}>
          <AppText color="needsWork">{error}</AppText>
          <Pressable onPress={load} style={{ marginTop: spacing.sm }}><AppText color="primary">Tap to retry</AppText></Pressable>
        </Card>
      ) : (
        <>
          <SectionHeader title="Team pulse" />
          <View style={{ flexDirection: 'row', gap: spacing.sm }}>
            <Card alt style={{ flex: 1 }}><AppText variant="title" color="text">{data?.athlete_count ?? 0}</AppText><AppText variant="caption" color="textSecondary">swimmers</AppText></Card>
            <Card alt style={{ flex: 1 }}><AppText variant="title" color="text">{data?.tested_this_week ?? 0}</AppText><AppText variant="caption" color="textSecondary">tested</AppText></Card>
            <Card alt style={{ flex: 1 }}><AppText variant="title" color="text">{data?.needs_attention?.length ?? 0}</AppText><AppText variant="caption" color="textSecondary">flagged</AppText></Card>
          </View>

          <SectionHeader title="Needs attention" />
          {data?.needs_attention?.length ? (
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between' }}>
              {data.needs_attention.map(renderNeedsCard)}
            </View>
          ) : (
            <AppText variant="body" color="textSecondary">Everyone's tracking well.</AppText>
          )}

          <SectionHeader title="Recent activity" />
          {data?.recent?.length ? (
            data.recent.map((s, i) => (
              <Pressable
                key={s.session_id || i}
                onPress={() => navigation.navigate('ReportCard', { sessionId: s.session_id, athleteName: s.name, sessionDate: s.date })}
                style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 10, borderBottomWidth: i < data.recent.length - 1 ? 1 : 0, borderBottomColor: colors.border }}
              >
                <AppText variant="body" color="text" numberOfLines={1} style={{ flex: 1 }}>
                  {s.name}{s.stroke_type ? ` · ${s.stroke_type}` : ''}
                </AppText>
                <AppText variant="caption" color="textMuted">{relDate(s.date)}</AppText>
              </Pressable>
            ))
          ) : (
            <AppText variant="body" color="textSecondary">No sessions yet.</AppText>
          )}
        </>
      )}
    </Screen>
    <AiBubble anchorSessionId={anchorSessionId} token={session?.access_token} open={chatOpen} onOpenChange={setChatOpen} />
    </View>
  );
}
