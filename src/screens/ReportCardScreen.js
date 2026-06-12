import React, { useEffect, useRef, useState } from 'react';
import {
  View, Text, TouchableOpacity, TextInput,
  ActivityIndicator, SafeAreaView, StyleSheet,
  ScrollView, Share, Alert, KeyboardAvoidingView, Platform,
} from 'react-native';
import VelocityChart from '../components/VelocityChart';
import { supabase } from '../lib/supabase';
import DataQualityCard from '../components/DataQualityCard';
import { useAuth } from '../context/AuthContext';
import { API_BASE } from '../config';

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
  card:     { backgroundColor: '#1a1a1a', borderRadius: 10, padding: 16, marginBottom: 16 },
  label:    { color: '#555', fontSize: 11, fontWeight: '600', letterSpacing: 1, marginBottom: 12 },
  row:      { flexDirection: 'row' },
  col:      { flex: 1, alignItems: 'center' },
  colLabel: { color: '#666', fontSize: 10, fontWeight: '600', letterSpacing: 0.5, marginBottom: 4 },
  colValue: { color: '#fff', fontSize: 22, fontWeight: '700' },
  colUnit:  { color: '#555', fontSize: 11, marginTop: 2 },
});

export default function ReportCardScreen({ route, navigation }) {
  const { sessionId, headWaistM = 0, athleteName, sessionDate } = route.params ?? {};
  const [sessionData, setSessionData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [sessionName, setSessionName] = useState(null);
  const [isStarred, setIsStarred]     = useState(false);
  const [notes, setNotes]             = useState(null);
  const [strokeType, setStrokeType]   = useState(null);
  const [editingName, setEditingName] = useState(false);
  const [markerTimeS, setMarkerTimeS] = useState(null);
  const [markerLabel, setMarkerLabel] = useState('');
  const [unit, setUnit] = useState('metric');
  const [scrollEnabled, setScrollEnabled] = useState(true);
  const scrollViewRef = useRef(null);
  const { session: authSession } = useAuth();

  useEffect(() => { navigation.setOptions({ gestureEnabled: false }); }, []);

  useEffect(() => {
    async function fetchSession() {
      try {
        const { data, error: err } = await supabase
          .from('sessions')
          .select('metrics_json, velocity_profile, distance_profile, name, notes, is_starred, stroke_type')
          .eq('id', sessionId)
          .single();
        if (err) throw err;
        setSessionData(data);
        setSessionName(data.name ?? null);
        setIsStarred(data.is_starred ?? false);
        setNotes(data.notes ?? null);
        setStrokeType(data.stroke_type ?? null);
      } catch (e) {
        setError('Failed to load session.');
      } finally {
        setLoading(false);
      }
    }
    fetchSession();
  }, [sessionId]);

  if (loading) {
    return (
      <SafeAreaView style={st.container}>
        <ActivityIndicator color="#2196F3" style={{ marginTop: 80 }} />
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
        <Text style={{ color: '#C0392B', textAlign: 'center', marginTop: 40 }}>
          {error ?? 'Failed to load session.'}
        </Text>
      </SafeAreaView>
    );
  }

  const metrics = sessionData.metrics_json ?? {};
  const vel = sessionData.velocity_profile ?? [];
  const dist = sessionData.distance_profile ?? [];
  const time = Array.from({ length: vel.length }, (_, i) => i / 100);

  const unitFactor = unit === 'imperial' ? 1.09361 : 1;
  const distUnit   = unit === 'imperial' ? 'yd' : 'm';
  const velUnit    = unit === 'imperial' ? 'yd/s' : 'm/s';
  const fmtDist    = (val) => val != null ? (val * unitFactor).toFixed(1) : null;
  const fmtVel     = (val) => val != null ? (val * unitFactor).toFixed(2) : null;
  const efficiencyUnreliable = (metrics.session?.cv_isi ?? 0) > 0.80;

  const STROKE_LABELS = {
    breaststroke: 'Breaststroke', freestyle: 'Freestyle',
    backstroke: 'Backstroke', butterfly: 'Butterfly',
    im: 'Individual Medley', udk: 'Underwater Dolphin Kick',
  };
  // null stroke_type = legacy session = show full analytics
  const isAnalyticsReady = !strokeType || strokeType === 'breaststroke';

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
      rows.push(`${(i / 100).toFixed(4)},${v},${d},${cycleIds[i]}`);
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
          placeholderTextColor="#888"
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

        {isAnalyticsReady ? (
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

            {/* Efficiency */}
            <View style={st.sectionCard}>
              <Text style={st.sectionTitle}>Efficiency</Text>
              {efficiencyUnreliable ? (
                <Text style={st.unreliableWarn}>
                  Stroke detection may be unreliable for this session.{'\n'}
                  Check recording conditions or technique consistency.
                </Text>
              ) : (
                <>
                  <View style={st.metricRow}>
                    <MetricItem label="Dist/Stroke" value={fmtDist(metrics.session?.mean_dps_m)}    unit={distUnit} />
                    <MetricItem label="Impulse"     value={fmtDist(metrics.session?.mean_impulse_m)} unit={distUnit} />
                    <MetricItem label="Coast"       value={metrics.session?.mean_coast_fraction != null ? (metrics.session.mean_coast_fraction * 100).toFixed(1) : null} unit="%" />
                  </View>
                  <View style={st.metricRow}>
                    <MetricItem label="ISI CV"      value={metrics.session?.cv_isi != null ? (metrics.session.cv_isi * 100).toFixed(1) : null} unit="%" />
                    <MetricItem label="Arm Peak CV" value={metrics.session?.cv_arm_peak_vel != null ? (metrics.session.cv_arm_peak_vel * 100).toFixed(1) : null} unit="%" />
                    <MetricItem label="Fatigue"     value={metrics.session?.fatigue_index_pct?.toFixed(1)} unit="%" />
                  </View>
                </>
              )}
            </View>
          </>
        ) : (
          <View style={st.comingSoonCard}>
            <Text style={st.comingSoonTitle}>
              {STROKE_LABELS[strokeType] ?? strokeType} Analytics
            </Text>
            <Text style={st.comingSoonText}>
              Detailed stroke metrics coming soon.{'\n'}Velocity data is still recorded and available for export.
            </Text>
          </View>
        )}

        {/* Velocity Chart */}
        <View style={st.chartHeader}>
          <Text style={st.chartTitle}>Velocity</Text>
          <View style={st.unitToggle}>
            <TouchableOpacity
              style={[st.unitBtn, unit === 'metric' && st.unitBtnActive]}
              onPress={() => setUnit('metric')}
            >
              <Text style={[st.unitBtnText, unit === 'metric' && st.unitBtnTextActive]}>m</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[st.unitBtn, unit === 'imperial' && st.unitBtnActive]}
              onPress={() => setUnit('imperial')}
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
          onInteractionStart={() => setScrollEnabled(false)}
          onInteractionEnd={() => setScrollEnabled(true)}
        />

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

        {/* Data Quality */}
        <DataQualityCard dataQuality={metrics.data_quality} />

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
            placeholderTextColor="#555"
            multiline
            numberOfLines={4}
            textAlignVertical="top"
            autoCapitalize="sentences"
          />
        </View>

      </ScrollView>
      </KeyboardAvoidingView>
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
  container:       { flex: 1, backgroundColor: '#000' },
  header:          { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, marginTop: 16, marginBottom: 8 },
  headerTitle:     { fontSize: 18, fontWeight: '700', color: '#fff' },
  back:            { fontSize: 14, color: '#2196F3' },
  exportBtn:       { paddingHorizontal: 10, paddingVertical: 4 },
  exportBtnText:   { fontSize: 14, color: '#2196F3' },
  dateLabel:       { fontSize: 13, color: '#888', textAlign: 'center', marginBottom: 8 },
  sectionCard:     { backgroundColor: '#1a1a1a', borderRadius: 12, padding: 14, marginBottom: 10 },
  sectionTitle:    { fontSize: 11, color: '#666', fontWeight: '600', letterSpacing: 1, textTransform: 'uppercase', marginBottom: 10 },
  metricRow:       { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 8 },
  metricLabel:     { fontSize: 11, color: '#666', textTransform: 'uppercase', letterSpacing: 0.5 },
  metricValue:     { fontSize: 22, fontWeight: '700', color: '#fff', marginTop: 2 },
  metricUnit:      { fontSize: 11, color: '#555' },
  chartHeader:     { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 4, marginBottom: 6 },
  chartTitle:      { fontSize: 11, fontWeight: '600', color: '#666', textTransform: 'uppercase', letterSpacing: 1 },
  unitToggle:      { flexDirection: 'row', gap: 6 },
  unitBtn:         { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8, backgroundColor: '#252525', borderWidth: 1, borderColor: '#333' },
  unitBtnActive:   { backgroundColor: '#2563EB', borderColor: '#2563EB' },
  unitBtnText:     { fontSize: 12, fontWeight: '600', color: '#888' },
  unitBtnTextActive: { color: '#fff' },
  noDetectText:    { fontSize: 13, color: '#888', fontStyle: 'italic', marginTop: 2 },
  unreliableWarn:  { fontSize: 13, color: '#E67E22', fontStyle: 'italic', lineHeight: 20, paddingVertical: 4 },
  ttxValue:        { fontSize: 42, fontWeight: '700', color: '#fff' },
  ttxLabel:        { fontSize: 14, color: '#888', marginBottom: 4 },
  ttxMax:          { fontSize: 11, color: '#666', marginBottom: 12 },
  ttxButtons:      { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 8, marginTop: 4 },
  ttxBtn:          { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 8, backgroundColor: '#252525', borderWidth: 1, borderColor: '#333' },
  ttxBtnActive:    { backgroundColor: '#2563EB', borderColor: '#2563EB' },
  ttxBtnText:      { fontSize: 14, fontWeight: '600', color: '#888' },
  ttxBtnTextActive: { color: '#fff' },
  headerRight:      { flexDirection: 'row', alignItems: 'center', gap: 4 },
  starBtn:          { paddingHorizontal: 8, paddingVertical: 4 },
  starBtnText:      { fontSize: 20, color: '#555' },
  starBtnTextActive:{ color: '#F39C12' },
  nameRow:          { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, marginBottom: 6, gap: 6 },
  nameText:         { fontSize: 15, fontWeight: '600', color: '#fff', flex: 1 },
  namePlaceholder:  { fontSize: 14, color: '#555', fontStyle: 'italic', flex: 1 },
  nameEdit:         { fontSize: 13, color: '#666' },
  nameInput:        { fontSize: 15, fontWeight: '600', color: '#fff', paddingHorizontal: 20, paddingVertical: 6, marginBottom: 6, borderBottomWidth: 1, borderBottomColor: '#2563EB' },
  comingSoonCard:   { backgroundColor: '#1a1a1a', borderRadius: 12, padding: 20, marginBottom: 10, alignItems: 'center' },
  comingSoonTitle:  { fontSize: 15, fontWeight: '700', color: '#fff', marginBottom: 8 },
  comingSoonText:   { fontSize: 13, color: '#888', textAlign: 'center', lineHeight: 20 },
  notesInput:       { fontSize: 14, color: '#ddd', minHeight: 88, paddingTop: 4, lineHeight: 20 },
});
