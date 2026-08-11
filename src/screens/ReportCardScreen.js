import React, { useEffect, useRef, useState } from 'react';
import {
  View, Text, TouchableOpacity, TextInput,
  ActivityIndicator, SafeAreaView, StyleSheet,
  ScrollView, Share, Alert, KeyboardAvoidingView, Platform,
} from 'react-native';
import VelocityChart from '../components/VelocityChart';
import { supabase } from '../lib/supabase';
import CycleCharts from '../components/CycleCharts';
import { dropoutWarning } from '../lib/dropoutWarning';
import PillarCards from '../components/PillarCards';
import AiBubble from '../components/ai/AiBubble';
import { useAuth } from '../context/AuthContext';
import { useUnits } from '../context/UnitsContext';
import { API_BASE } from '../config';
import { colors } from '../theme';

// ── SESSION summary card (top of report) ─────────────────────────────────────
function SessionSummaryCard({ metrics, unit }) {
  const s = metrics?.session ?? {};
  const lapRaw = s.lap_time_s;
  const lapFmt = lapRaw != null
    ? lapRaw >= 60
      ? `${Math.floor(lapRaw / 60)}:${String(Math.round(lapRaw % 60)).padStart(2, '0')}`
      : lapRaw.toFixed(1)
    : '--';
  const rate  = s.stroke_rate_spm?.toFixed(1) ?? '--';
  const speed = s.mean_vel_ms != null
    ? (unit === 'imperial' ? (s.mean_vel_ms * 1.09361).toFixed(2) : s.mean_vel_ms.toFixed(2))
    : '--';
  const speedUnit = unit === 'imperial' ? 'yd/s' : 'm/s';
  return (
    <View style={ssc.card}>
      <Text style={ssc.label}>SESSION</Text>
      <View style={ssc.row}>
        <View style={ssc.col}>
          <Text style={ssc.colLabel}>LAP TIME</Text>
          <Text style={ssc.colValue}>{lapFmt}</Text>
          <Text style={ssc.colUnit}>s</Text>
        </View>
        <View style={ssc.col}>
          <Text style={ssc.colLabel}>RATE</Text>
          <Text style={ssc.colValue}>{rate}</Text>
          <Text style={ssc.colUnit}>SPM</Text>
        </View>
        <View style={ssc.col}>
          <Text style={ssc.colLabel}>SPEED</Text>
          <Text style={ssc.colValue}>{speed}</Text>
          <Text style={ssc.colUnit}>{speedUnit}</Text>
        </View>
      </View>
    </View>
  );
}
const ssc = StyleSheet.create({
  card:     { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: 12, padding: 16, marginBottom: 16 },
  label:    { color: colors.textSecondary, fontSize: 11, fontWeight: '600', letterSpacing: 1, marginBottom: 12 },
  row:      { flexDirection: 'row' },
  col:      { flex: 1, alignItems: 'center' },
  colLabel: { color: colors.textSecondary, fontSize: 10, fontWeight: '600', letterSpacing: 0.5, marginBottom: 4 },
  colValue: { color: colors.text, fontSize: 22, fontWeight: '700' },
  colUnit:  { color: colors.textMuted, fontSize: 11, marginTop: 2 },
});

export default function ReportCardScreen({ route, navigation }) {
  const { sessionId, headWaistM = 0, athleteName, sessionDate } = route.params ?? {};
  const [sessionData, setSessionData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [sessionName, setSessionName] = useState(null);
  const [isStarred, setIsStarred]     = useState(false);
  const [notes, setNotes]             = useState(null);
  const [strokeType, setStrokeType]   = useState(null);
  const [editingName, setEditingName] = useState(false);
  const [markerTimeS, setMarkerTimeS] = useState(null);
  const [markerLabel, setMarkerLabel] = useState('');
  const [prevSessionId, setPrevSessionId] = useState(null);
  const { unit: unitPref, setUnit: setUnitPref } = useUnits();  // global m/yd pref (Settings)
  const unit = unitPref === 'yd' ? 'imperial' : 'metric';        // local convention kept
  const [view, setView] = useState('simple');   // 'simple' = pillar cards, 'advanced' = raw metrics
  const [scrollEnabled, setScrollEnabled] = useState(true);
  const scrollViewRef = useRef(null);
  const { session: authSession } = useAuth();

  useEffect(() => { navigation.setOptions({ gestureEnabled: false }); }, []);

  useEffect(() => {
    let cancelled = false;
    async function fetchSession() {
      setLoading(true);
      setError(null);
      try {
        const { data, error: err } = await supabase
          .from('sessions')
          .select('metrics_json, velocity_profile, distance_profile, name, notes, is_starred, stroke_type, athlete_id, created_at, sample_rate_hz')
          .eq('id', sessionId)
          .single();
        if (err) {
          // PGRST116 = no row matched .single() → the session is gone.
          if (err.code === 'PGRST116') throw new Error('not-found');
          throw err;
        }
        if (!data) throw new Error('not-found');
        if (!data.metrics_json) throw new Error('incomplete');
        if (cancelled) return;
        setSessionData(data);
        setSessionName(data.name ?? null);
        setIsStarred(data.is_starred ?? false);
        setNotes(data.notes ?? null);
        setStrokeType(data.stroke_type ?? null);
        // Find this athlete's previous session (for "compare to previous").
        if (data.athlete_id && data.created_at) {
          const { data: prev } = await supabase
            .from('sessions')
            .select('id')
            .eq('athlete_id', data.athlete_id)
            .lt('created_at', data.created_at)
            .order('created_at', { ascending: false })
            .limit(1);
          if (!cancelled) setPrevSessionId(prev?.[0]?.id ?? null);
        }
      } catch (e) {
        if (cancelled) return;
        const msg = e?.message || '';
        if (msg === 'not-found') setError('Session not found. It may have been deleted.');
        else if (msg === 'incomplete') setError("This session's data looks incomplete — it can't be displayed.");
        else if (/network|fetch|offline|connection|load failed/i.test(msg)) setError('You appear to be offline. Check your connection and tap Retry.');
        else setError('Failed to load session.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    fetchSession();
    return () => { cancelled = true; };
  }, [sessionId, reloadKey]);

  if (loading) {
    return (
      <SafeAreaView style={st.container}>
        <ActivityIndicator color={colors.primary} style={{ marginTop: 80 }} />
      </SafeAreaView>
    );
  }

  if (error || !sessionData) {
    return (
      <SafeAreaView style={st.container}>
        <View style={st.header}>
          <TouchableOpacity onPress={() => navigation.goBack()}>
            <Text style={st.back}>‹ Back</Text>
          </TouchableOpacity>
          <View style={{ width: 60 }} />
        </View>
        <Text style={{ color: colors.needsWork, textAlign: 'center', marginTop: 40, paddingHorizontal: 24, lineHeight: 22 }}>
          {error ?? 'Failed to load session.'}
        </Text>
        <TouchableOpacity
          onPress={() => { setLoading(true); setReloadKey(k => k + 1); }}
          style={{ alignSelf: 'center', marginTop: 20, paddingVertical: 11, paddingHorizontal: 28, backgroundColor: colors.primary, borderRadius: 8 }}
        >
          <Text style={{ color: colors.white, fontWeight: '600' }}>Retry</Text>
        </TouchableOpacity>
      </SafeAreaView>
    );
  }

  const metrics = sessionData.metrics_json ?? {};
  const vel = sessionData.velocity_profile ?? [];
  const dist = sessionData.distance_profile ?? [];

  // The session's TRUE sample rate. run_pipeline decimates by an integer factor, so the requested
  // 100 Hz is essentially never achieved (~89.5 Hz is typical) — `sessions.sample_rate_hz` is the
  // authoritative per-session value. NULL means the row predates Phase 52 and has no recorded rate;
  // 100 reproduces exactly how those rows have always rendered here. Do NOT backfill the column —
  // that would erase the distinction between "genuinely 100" and "unknown".
  // Mirrors web/app/app/sessions/[id]/page.js:120, including the `> 0` guard (which also rejects 0).
  const fsHz = sessionData.sample_rate_hz > 0 ? sessionData.sample_rate_hz : 100;
  const time = Array.from({ length: vel.length }, (_, i) => i / fsHz);

  // Advanced-only: cycle boundary times for the segmentation overlay on the chart. Cycle bounds are
  // stored as sample INDICES, so converting them to seconds needs the same rate as `time`.
  const cycleBoundaries = view === 'advanced'
    ? Array.from(new Set(
        (metrics.cycles ?? []).flatMap(c => [c.start_idx, c.end_idx].filter(x => x != null)),
      )).sort((a, b) => a - b).map(i => i / fsHz)
    : [];

  const unitFactor = unit === 'imperial' ? 1.09361 : 1;
  const distUnit   = unit === 'imperial' ? 'yd' : 'm';
  const velUnit    = unit === 'imperial' ? 'yd/s' : 'm/s';
  const fmtDist    = (val) => val != null ? (val * unitFactor).toFixed(1) : null;
  const fmtVel     = (val) => val != null ? (val * unitFactor).toFixed(2) : null;
  const efficiencyUnreliable = (metrics.session?.cv_isi ?? 0) > 0.80;
  const dropoutMsg = dropoutWarning(metrics.data_quality);

  const STROKE_LABELS = {
    breaststroke: 'Breaststroke', freestyle: 'Freestyle',
    backstroke: 'Backstroke', butterfly: 'Butterfly',
    im: 'Individual Medley', udk: 'Underwater Dolphin Kick',
  };
  // Phase 54: the breaststroke-only gate is lifted — every stroke shows full analytics, matching
  // the backend (ratings.py now bands all strokes) and the web portal, which never gated at all.
  // To restore: `!strokeType || strokeType === 'breaststroke'`. All usage sites below are kept
  // intact, including the !isAnalyticsReady "Coming Soon" branch, so this stays a one-line revert.
  const isAnalyticsReady = true;

  async function exportCsv() {
    if (vel.length === 0) {
      Alert.alert('No data', 'This session has no signal data to export.');
      return;
    }

    // Build cycle_id lookup: sample index → 1-based cycle number (0 = not in a cycle)
    const cycles = metrics.cycles ?? [];
    const cycleIds = new Array(vel.length).fill(0);
    cycles.forEach((cycle, idx) => {
      const s = cycle.start_idx ?? 0;
      const e = cycle.end_idx ?? 0;
      for (let i = Math.max(0, s); i <= Math.min(e, vel.length - 1); i++) {
        cycleIds[i] = idx + 1;
      }
    });

    // Build CSV string
    const rows = ['time_s,velocity_ms,distance_m,cycle_id'];
    for (let i = 0; i < vel.length; i++) {
      const v = vel[i] != null ? vel[i].toFixed(6) : '';
      const d = dist[i] != null ? dist[i].toFixed(6) : '';
      rows.push(`${(i / fsHz).toFixed(4)},${v},${d},${cycleIds[i]}`);
    }
    const csvString = rows.join('\n');

    try {
      await Share.share(
        { message: csvString, title: `Session ${sessionDate ?? ''}` },
        { dialogTitle: 'Export session CSV' },
      );
    } catch {
      // user cancelled — no-op
    }
  }

  async function patchSession(updates) {
    if (!authSession?.access_token) return;
    try {
      await fetch(`${API_BASE}/sessions/${sessionId}`, {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${authSession.access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(updates),
      });
    } catch {
      // non-fatal — optimistic update already applied
    }
  }

  function confirmDelete() {
    Alert.alert(
      'Delete session',
      `Delete this session${sessionName ? ` "${sessionName}"` : ''}? This cannot be undone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete', style: 'destructive',
          onPress: async () => {
            try {
              await fetch(`${API_BASE}/sessions/${sessionId}`, {
                method: 'DELETE',
                headers: { Authorization: `Bearer ${authSession?.access_token}` },
              });
            } catch {
              // best-effort; the list refetches on focus
            }
            navigation.goBack();
          },
        },
      ],
    );
  }

  return (
    <SafeAreaView style={st.container}>
      <View style={st.header}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Text style={st.back}>‹ History</Text>
        </TouchableOpacity>
        <Text style={st.headerTitle}>{athleteName}</Text>
        <View style={st.headerRight}>
          <TouchableOpacity
            onPress={() => {
              const next = !isStarred;
              setIsStarred(next);
              patchSession({ is_starred: next });
            }}
            style={st.starBtn}
          >
            <Text style={[st.starBtnText, isStarred && st.starBtnTextActive]}>
              {isStarred ? '★' : '☆'}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={confirmDelete} style={st.starBtn} accessibilityLabel="Delete session">
            <Text style={st.deleteGlyph}>🗑</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={exportCsv} style={st.exportBtn}>
            <Text style={st.exportBtnText}>Export</Text>
          </TouchableOpacity>
        </View>
      </View>
      {sessionDate && <Text style={st.dateLabel}>{sessionDate}</Text>}

      {/* Editable session name */}
      {editingName ? (
        <TextInput
          style={st.nameInput}
          value={sessionName ?? ''}
          onChangeText={setSessionName}
          onBlur={() => {
            setEditingName(false);
            patchSession({ name: sessionName?.trim() || null });
          }}
          placeholder="Session name…"
          placeholderTextColor={colors.textMuted}
          autoFocus
          autoCapitalize="sentences"
          returnKeyType="done"
        />
      ) : (
        <TouchableOpacity onPress={() => setEditingName(true)} style={st.nameRow}>
          <Text style={sessionName ? st.nameText : st.namePlaceholder}>
            {sessionName ?? 'Add session name…'}
          </Text>
          <Text style={st.nameEdit}>✎</Text>
        </TouchableOpacity>
      )}

      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={{ flex: 1 }}
      >
      <ScrollView
        ref={scrollViewRef}
        scrollEnabled={scrollEnabled}
        contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 24 }}
      >

        <SessionSummaryCard metrics={metrics} unit={unit} />

        {isAnalyticsReady && (
          <View style={st.viewToggle}>
            <TouchableOpacity
              style={[st.viewBtn, view === 'simple' && st.viewBtnActive]}
              onPress={() => setView('simple')}
            >
              <Text style={[st.viewBtnText, view === 'simple' && st.viewBtnTextActive]}>Simple</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[st.viewBtn, view === 'advanced' && st.viewBtnActive]}
              onPress={() => setView('advanced')}
            >
              <Text style={[st.viewBtnText, view === 'advanced' && st.viewBtnTextActive]}>Advanced</Text>
            </TouchableOpacity>
          </View>
        )}

        {isAnalyticsReady && view === 'simple' && (
          <PillarCards sessionId={sessionId} token={authSession?.access_token} unit={unit} />
        )}

        {isAnalyticsReady && view === 'advanced' && (
          <>
            {/* Start Phase */}
            <View style={st.sectionCard}>
              <Text style={st.sectionTitle}>Start Phase</Text>
              {metrics.initial_phase?.dive_detected ? (
                <View style={st.metricRow}>
                  <MetricItem label="Dive Duration" value={metrics.initial_phase.dive_duration_s?.toFixed(2)}      unit="s" />
                  <MetricItem label="Pulldown Peak" value={fmtVel(metrics.initial_phase.pulldown_peak_vel_ms)} unit={velUnit} />
                  <MetricItem label="Pulldown Time" value={metrics.initial_phase.pulldown_duration_s?.toFixed(2)}  unit="s" />
                </View>
              ) : (
                <Text style={st.noDetectText}>
                  {metrics.initial_phase?.pulldown_detected
                    ? 'Pulldown detected — no dive surge'
                    : 'Wall start — no dive or pulldown'}
                </Text>
              )}
            </View>

            {/* Session */}
            <View style={st.sectionCard}>
              <Text style={st.sectionTitle}>Session</Text>
              <View style={st.metricRow}>
                <MetricItem label="Lap Time"    value={metrics.session?.lap_time_s?.toFixed(2)}      unit="s" />
                <MetricItem label="Distance"    value={fmtDist(metrics.session?.total_dist_m)}        unit={distUnit} />
                <MetricItem label="Active Rate" value={metrics.session?.stroke_rate_spm?.toFixed(1)}  unit="SPM" />
              </View>
              <View style={st.metricRow}>
                <MetricItem label="Strokes"   value={metrics.session?.stroke_count}               unit="" />
                <MetricItem label="Avg Speed" value={fmtVel(metrics.session?.mean_vel_ms)}        unit={velUnit} />
                <MetricItem label="Max Speed" value={fmtVel(metrics.session?.max_vel_ms)}         unit={velUnit} />
              </View>
            </View>

            {/* Efficiency — per-cycle trends (Phase 60 D2). The six scalars these replace are now
                captions on the charts they summarize; `cv_isi` and `cv_arm_peak_vel` are the
                DISPERSION of the duration and arm-peak series, not per-cycle quantities, so they
                caption those two panels rather than getting panels of their own. */}
            <View style={st.sectionCard}>
              <Text style={st.sectionTitle}>Efficiency</Text>
              {/* D10: a high ISI CV no longer BLANKS this section. The charts show exactly the
                  scatter that made it high, so the warning belongs above them, not instead. */}
              {efficiencyUnreliable && (
                <Text style={st.unreliableWarn}>
                  Stroke detection may be unreliable for this session.{'\n'}
                  Check recording conditions or technique consistency.
                </Text>
              )}
              <CycleCharts
                cycles={metrics.cycles}
                session={metrics.session}
                unitFactor={unitFactor}
                distUnit={distUnit}
                velUnit={velUnit}
              />
              <View style={st.metricRow}>
                <MetricItem label="Fatigue" value={metrics.session?.fatigue_index_pct?.toFixed(1)} unit="%" />
              </View>
            </View>
          </>
        )}

        {!isAnalyticsReady && (
          <View style={st.comingSoonCard}>
            <Text style={st.comingSoonTitle}>
              {STROKE_LABELS[strokeType] ?? strokeType} Analytics
            </Text>
            <Text style={st.comingSoonText}>
              Detailed stroke metrics coming soon.{'\n'}Velocity data is still recorded and available for export.
            </Text>
          </View>
        )}

        {prevSessionId && (
          <TouchableOpacity
            style={st.compareBtn}
            onPress={() => navigation.navigate('Compare', { sessionIds: [prevSessionId, sessionId] })}
          >
            <Text style={st.compareBtnText}>⇄ Compare to previous</Text>
          </TouchableOpacity>
        )}

        {/* Velocity Chart */}
        <View style={st.chartHeader}>
          <Text style={st.chartTitle}>Velocity</Text>
          <View style={st.unitToggle}>
            <TouchableOpacity
              style={[st.unitBtn, unit === 'metric' && st.unitBtnActive]}
              onPress={() => setUnitPref('m')}
            >
              <Text style={[st.unitBtnText, unit === 'metric' && st.unitBtnTextActive]}>m</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[st.unitBtn, unit === 'imperial' && st.unitBtnActive]}
              onPress={() => setUnitPref('yd')}
            >
              <Text style={[st.unitBtnText, unit === 'imperial' && st.unitBtnTextActive]}>yd</Text>
            </TouchableOpacity>
          </View>
        </View>
        <VelocityChart
          time={time}
          velocity={vel}
          markerTimeS={markerTimeS}
          markerLabel={markerLabel}
          unitFactor={unitFactor}
          unitLabel={velUnit}
          interactive
          brush
          cycleBoundaries={cycleBoundaries}
          onInteractionStart={() => setScrollEnabled(false)}
          onInteractionEnd={() => setScrollEnabled(true)}
        />
        {cycleBoundaries.length > 0 && (
          <Text style={st.chartCaption}>
            Dashed lines = detected stroke cycles. Segmentation is experimental.
          </Text>
        )}

        {isAnalyticsReady && (
          <View style={st.sectionCard}>
            <Text style={st.sectionTitle}>Time to Distance</Text>
            <TimeToX
              timeArr={time}
              distArr={dist}
              baselineEndS={metrics.session?.baseline_end_s}
              headWaistM={headWaistM}
              onMarkerChange={(tS, lbl) => { setMarkerTimeS(tS); setMarkerLabel(lbl); }}
              unit={unit}
            />
          </View>
        )}

        {/* Encoder dropout — all that remains of the retired Data Quality card (D3/D9) */}
        {dropoutMsg && (
          <View style={st.dropoutStrip}>
            <Text style={st.dropoutText}>⚠ {dropoutMsg}</Text>
          </View>
        )}

        {/* Notes */}
        <View style={st.sectionCard}>
          <Text style={st.sectionTitle}>Notes</Text>
          <TextInput
            style={st.notesInput}
            value={notes ?? ''}
            onChangeText={setNotes}
            onBlur={() => patchSession({ notes: notes?.trim() || null })}
            onFocus={() => scrollViewRef.current?.scrollToEnd({ animated: true })}
            placeholder="Add coaching notes…"
            placeholderTextColor={colors.textMuted}
            multiline
            numberOfLines={4}
            textAlignVertical="top"
            autoCapitalize="sentences"
          />
        </View>

      </ScrollView>
      </KeyboardAvoidingView>
      <AiBubble anchorSessionId={sessionId} token={authSession?.access_token} />
    </SafeAreaView>
  );
}

// ── MetricItem ────────────────────────────────────────────────────────────────
function MetricItem({ label, value, unit }) {
  return (
    <View style={{ alignItems: 'center', flex: 1 }}>
      <Text style={st.metricLabel}>{label}</Text>
      <Text style={st.metricValue}>{value ?? '--'}</Text>
      {unit ? <Text style={st.metricUnit}>{unit}</Text> : null}
    </View>
  );
}

// ── TimeToX ───────────────────────────────────────────────────────────────────
const ALL_PRESETS = [5, 10, 15, 20, 25];
const YARD_TO_M = 0.9144;

function computeTimeToX(timeArr, distArr, baselineEndS, headWaistM, targetM) {
  if (!timeArr?.length || !distArr?.length || baselineEndS == null) return null;
  const baseIdx = timeArr.findIndex(t => t >= baselineEndS);
  if (baseIdx < 0) return null;
  const distBase = distArr[baseIdx];
  const waistTarget = targetM - (headWaistM || 0);
  if (waistTarget <= 0) return null;
  const crossIdx = distArr.findIndex((d, i) => i >= baseIdx && d != null && d >= distBase + waistTarget);
  if (crossIdx < 0) return null;
  return parseFloat((timeArr[crossIdx] - timeArr[baseIdx]).toFixed(2));
}

function TimeToX({ timeArr, distArr, baselineEndS, headWaistM = 0, onMarkerChange, unit = 'metric' }) {
  const imp = unit === 'imperial';
  const unitSuffix = imp ? 'yd' : 'm';

  const { presets, maxReachableM } = React.useMemo(() => {
    if (!timeArr?.length || !distArr?.length || baselineEndS == null) {
      return { presets: ALL_PRESETS, maxReachableM: null };
    }
    const baseIdx = timeArr.findIndex(t => t >= baselineEndS);
    if (baseIdx < 0) return { presets: ALL_PRESETS, maxReachableM: null };
    const distBase = distArr[baseIdx] ?? 0;
    const distMax = distArr[distArr.length - 1] ?? 0;
    const maxM = Math.max(0, distMax - distBase - (headWaistM || 0));
    // Filter presets by max reachable distance in the current unit
    const maxInUnit = imp ? maxM / YARD_TO_M : maxM;
    const visible = ALL_PRESETS.filter(p => p <= Math.ceil(maxInUnit) + 1);
    return { presets: visible.length > 0 ? visible : ALL_PRESETS, maxReachableM: maxM };
  }, [timeArr, distArr, baselineEndS, headWaistM, imp]);

  const defaultTarget = presets[Math.min(presets.length - 1, presets.findIndex(p => p >= 10) >= 0 ? presets.findIndex(p => p >= 10) : presets.length - 1)];
  const [targetVal, setTargetVal] = React.useState(defaultTarget);

  React.useEffect(() => {
    if (!presets.includes(targetVal)) setTargetVal(presets[presets.length - 1]);
  }, [presets]);

  // Convert the selected preset to meters for internal computation
  const targetMeters = imp ? targetVal * YARD_TO_M : targetVal;

  const timeToX = React.useMemo(
    () => computeTimeToX(timeArr, distArr, baselineEndS, headWaistM, targetMeters),
    [timeArr, distArr, baselineEndS, headWaistM, targetMeters],
  );

  // Absolute chart timestamp of the crossing point (for marker line placement)
  const markerAbsoluteTimeS = React.useMemo(() => {
    if (!timeArr?.length || !distArr?.length || baselineEndS == null) return null;
    const baseIdx = timeArr.findIndex(t => t >= baselineEndS);
    if (baseIdx < 0) return null;
    const distBase = distArr[baseIdx];
    const waistTarget = targetMeters - (headWaistM || 0);
    if (waistTarget <= 0) return null;
    const crossIdx = distArr.findIndex((d, i) => i >= baseIdx && d != null && d >= distBase + waistTarget);
    if (crossIdx < 0) return null;
    return timeArr[crossIdx];
  }, [timeArr, distArr, baselineEndS, headWaistM, targetMeters]);

  React.useEffect(() => {
    if (!onMarkerChange) return;
    onMarkerChange(markerAbsoluteTimeS, `${targetVal}${unitSuffix}`);
  }, [markerAbsoluteTimeS, targetVal, unit]);

  const maxDisplay = maxReachableM != null
    ? (imp ? `${(maxReachableM / YARD_TO_M).toFixed(1)} yd` : `${maxReachableM.toFixed(1)} m`)
    : null;

  return (
    <View style={{ alignItems: 'center' }}>
      <Text style={st.ttxValue}>{timeToX != null ? `${timeToX} s` : '--'}</Text>
      <Text style={st.ttxLabel}>to {targetVal} {unitSuffix}</Text>
      {maxDisplay != null && (
        <Text style={st.ttxMax}>Max from start: {maxDisplay}</Text>
      )}
      <View style={st.ttxButtons}>
        {presets.map(p => (
          <TouchableOpacity
            key={p}
            style={[st.ttxBtn, targetVal === p && st.ttxBtnActive]}
            onPress={() => setTargetVal(p)}
          >
            <Text style={[st.ttxBtnText, targetVal === p && st.ttxBtnTextActive]}>
              {p}{unitSuffix}
            </Text>
          </TouchableOpacity>
        ))}
      </View>
    </View>
  );
}

// ── Styles ─────────────────────────────────────────────────────────────────────
const st = StyleSheet.create({
  container:       { flex: 1, backgroundColor: colors.bg },
  header:          { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, marginTop: 16, marginBottom: 8 },
  headerTitle:     { fontSize: 18, fontWeight: '700', color: colors.text },
  back:            { fontSize: 14, color: colors.primary },
  exportBtn:       { paddingHorizontal: 10, paddingVertical: 4 },
  exportBtnText:   { fontSize: 14, color: colors.primary },
  dateLabel:       { fontSize: 13, color: colors.textSecondary, textAlign: 'center', marginBottom: 8 },
  sectionCard:     { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: 12, padding: 14, marginBottom: 10 },
  sectionTitle:    { fontSize: 11, color: colors.textSecondary, fontWeight: '600', letterSpacing: 1, textTransform: 'uppercase', marginBottom: 10 },
  metricRow:       { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 8 },
  metricLabel:     { fontSize: 11, color: colors.textSecondary, textTransform: 'uppercase', letterSpacing: 0.5 },
  metricValue:     { fontSize: 22, fontWeight: '700', color: colors.text, marginTop: 2 },
  metricUnit:      { fontSize: 11, color: colors.textMuted },
  chartHeader:     { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 4, marginBottom: 6 },
  chartTitle:      { fontSize: 11, fontWeight: '600', color: colors.textSecondary, textTransform: 'uppercase', letterSpacing: 1 },
  chartCaption:    { fontSize: 11, color: colors.textMuted, fontStyle: 'italic', textAlign: 'center', marginTop: 6 },
  unitToggle:      { flexDirection: 'row', gap: 6 },
  unitBtn:         { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8, backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: colors.border },
  unitBtnActive:   { backgroundColor: colors.primary, borderColor: colors.primary },
  unitBtnText:     { fontSize: 12, fontWeight: '600', color: colors.textSecondary },
  unitBtnTextActive: { color: colors.white },
  noDetectText:    { fontSize: 13, color: colors.textSecondary, fontStyle: 'italic', marginTop: 2 },
  unreliableWarn:  { fontSize: 13, color: colors.ok, fontStyle: 'italic', lineHeight: 20, paddingVertical: 4 },
  ttxValue:        { fontSize: 42, fontWeight: '700', color: colors.text },
  ttxLabel:        { fontSize: 14, color: colors.textSecondary, marginBottom: 4 },
  ttxMax:          { fontSize: 11, color: colors.textMuted, marginBottom: 12 },
  ttxButtons:      { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 8, marginTop: 4 },
  ttxBtn:          { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 8, backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: colors.border },
  ttxBtnActive:    { backgroundColor: colors.primary, borderColor: colors.primary },
  ttxBtnText:      { fontSize: 14, fontWeight: '600', color: colors.textSecondary },
  ttxBtnTextActive: { color: colors.white },
  headerRight:      { flexDirection: 'row', alignItems: 'center', gap: 4 },
  starBtn:          { paddingHorizontal: 8, paddingVertical: 4 },
  starBtnText:      { fontSize: 20, color: colors.textMuted },
  starBtnTextActive:{ color: colors.ok },
  deleteGlyph:      { fontSize: 18, color: colors.needsWork },
  nameRow:          { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, marginBottom: 6, gap: 6 },
  nameText:         { fontSize: 15, fontWeight: '600', color: colors.text, flex: 1 },
  namePlaceholder:  { fontSize: 14, color: colors.textMuted, fontStyle: 'italic', flex: 1 },
  nameEdit:         { fontSize: 13, color: colors.periwinkle },
  nameInput:        { fontSize: 15, fontWeight: '600', color: colors.text, paddingHorizontal: 20, paddingVertical: 6, marginBottom: 6, borderBottomWidth: 1, borderBottomColor: colors.primary },
  viewToggle:       { flexDirection: 'row', gap: 8, marginBottom: 12 },
  viewBtn:          { flex: 1, paddingVertical: 8, borderRadius: 8, backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: colors.border, alignItems: 'center' },
  viewBtnActive:    { backgroundColor: colors.primary, borderColor: colors.primary },
  viewBtnText:      { fontSize: 13, fontWeight: '600', color: colors.textSecondary },
  viewBtnTextActive:{ color: colors.white },
  comingSoonCard:   { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: 12, padding: 20, marginBottom: 10, alignItems: 'center' },
  comingSoonTitle:  { fontSize: 15, fontWeight: '700', color: colors.text, marginBottom: 8 },
  comingSoonText:   { fontSize: 13, color: colors.textSecondary, textAlign: 'center', lineHeight: 20 },
  notesInput:       { fontSize: 14, color: colors.text, minHeight: 88, paddingTop: 4, lineHeight: 20 },
  compareBtn:       { borderWidth: 1, borderColor: colors.border, borderRadius: 12, paddingVertical: 12, alignItems: 'center', marginBottom: 12 },
  compareBtnText:   { fontSize: 13, fontWeight: '600', color: colors.primary },
  dropoutStrip:     { backgroundColor: colors.okBg, borderRadius: 8, paddingVertical: 10, paddingHorizontal: 12, marginBottom: 10 },
  dropoutText:      { fontSize: 12, color: colors.ok, lineHeight: 17 },
});
