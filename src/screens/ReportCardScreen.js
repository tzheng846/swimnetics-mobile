import React, { useEffect, useState } from 'react';
import {
  View, Text, TouchableOpacity,
  ActivityIndicator, SafeAreaView, StyleSheet,
  ScrollView, Dimensions,
} from 'react-native';
import Svg, { Polyline, Line, Text as SvgText } from 'react-native-svg';
import { supabase } from '../lib/supabase';

export default function ReportCardScreen({ route, navigation }) {
  const { sessionId, headWaistM = 0, athleteName, sessionDate } = route.params ?? {};
  const [sessionData, setSessionData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    async function fetchSession() {
      try {
        const { data, error: err } = await supabase
          .from('sessions')
          .select('metrics_json, velocity_profile, distance_profile')
          .eq('id', sessionId)
          .single();
        if (err) throw err;
        setSessionData(data);
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

  return (
    <SafeAreaView style={st.container}>
      <View style={st.header}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Text style={st.back}>‹ History</Text>
        </TouchableOpacity>
        <Text style={st.headerTitle}>{athleteName}</Text>
        <View style={{ width: 60 }} />
      </View>
      {sessionDate && <Text style={st.dateLabel}>{sessionDate}</Text>}

      <ScrollView contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 24 }}>

        {/* Start Phase */}
        <View style={st.sectionCard}>
          <Text style={st.sectionTitle}>Start Phase</Text>
          {metrics.initial_phase?.dive_detected ? (
            <View style={st.metricRow}>
              <MetricItem label="Dive Duration" value={metrics.initial_phase.dive_duration_s?.toFixed(2)}      unit="s" />
              <MetricItem label="Pulldown Peak" value={metrics.initial_phase.pulldown_peak_vel_ms?.toFixed(2)} unit="m/s" />
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
            <MetricItem label="Distance"    value={metrics.session?.total_dist_m?.toFixed(1)}     unit="m" />
            <MetricItem label="Stroke Rate" value={metrics.session?.stroke_rate_spm?.toFixed(1)}  unit="SPM" />
          </View>
          <View style={st.metricRow}>
            <MetricItem label="Strokes"   value={metrics.session?.stroke_count}               unit="" />
            <MetricItem label="Avg Speed" value={metrics.session?.mean_vel_ms?.toFixed(2)}    unit="m/s" />
            <MetricItem label="Max Speed" value={metrics.session?.max_vel_ms?.toFixed(2)}     unit="m/s" />
          </View>
        </View>

        {/* Efficiency */}
        <View style={st.sectionCard}>
          <Text style={st.sectionTitle}>Efficiency</Text>
          <View style={st.metricRow}>
            <MetricItem label="Dist/Stroke" value={metrics.session?.mean_dps_m?.toFixed(2)} unit="m" />
            <MetricItem label="Impulse"     value={metrics.session?.mean_impulse_m?.toFixed(2)} unit="m" />
            <MetricItem label="Coast"       value={metrics.session?.mean_coast_fraction != null ? (metrics.session.mean_coast_fraction * 100).toFixed(1) : null} unit="%" />
          </View>
          <View style={st.metricRow}>
            <MetricItem label="ISI CV"      value={metrics.session?.cv_isi != null ? (metrics.session.cv_isi * 100).toFixed(1) : null} unit="%" />
            <MetricItem label="Arm Peak CV" value={metrics.session?.cv_arm_peak_vel != null ? (metrics.session.cv_arm_peak_vel * 100).toFixed(1) : null} unit="%" />
            <MetricItem label="Fatigue"     value={metrics.session?.fatigue_index_pct?.toFixed(1)} unit="%" />
          </View>
        </View>

        {/* Velocity Chart */}
        <Text style={st.chartTitle}>Velocity</Text>
        <VelocityChart time={time} velocity={vel} />

        {/* Time to Distance */}
        <View style={st.sectionCard}>
          <Text style={st.sectionTitle}>Time to Distance</Text>
          <TimeToX
            timeArr={time}
            distArr={dist}
            baselineEndS={metrics.session?.baseline_end_s}
            headWaistM={headWaistM}
          />
        </View>

      </ScrollView>
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

// ── VelocityChart ─────────────────────────────────────────────────────────────
function VelocityChart({ time, velocity }) {
  const W = Dimensions.get('window').width - 48;
  const H = 150;
  const PAD = 4;

  if (!time || time.length < 2) {
    return <Text style={{ color: '#999', marginTop: 8 }}>No data</Text>;
  }

  const step = Math.max(1, Math.floor(time.length / 400));
  const indices = [];
  for (let i = 0; i < time.length; i += step) {
    if (velocity[i] != null && !isNaN(velocity[i])) indices.push(i);
  }
  if (indices.length < 2) return <Text style={{ color: '#999', marginTop: 8 }}>No data</Text>;
  const t = indices.map(i => time[i]);
  const v = indices.map(i => velocity[i]);

  const tMin = t[0], tMax = t[t.length - 1];
  const vMin = Math.min(...v), vMax = Math.max(...v);
  const vRange = vMax - vMin || 1;
  const tRange = tMax - tMin || 1;

  const px = (val) => PAD + ((val - tMin) / tRange) * (W - PAD * 2);
  const py = (val) => H - PAD - ((val - vMin) / vRange) * (H - PAD * 2);

  const points = t.map((ti, i) => `${px(ti).toFixed(1)},${py(v[i]).toFixed(1)}`).join(' ');
  const zeroY = py(0) < 0 ? -1 : py(0) > H ? H + 1 : py(0);

  return (
    <Svg width={W} height={H + 20}>
      <Line x1={PAD} y1={zeroY} x2={W - PAD} y2={zeroY} stroke="#E8E8E8" strokeWidth={1} />
      <Polyline points={points} fill="none" stroke="#1E3A5F" strokeWidth={1.5} />
      <SvgText x={PAD} y={H + 14} fontSize={10} fill="#AAA">{tMin.toFixed(0)}s</SvgText>
      <SvgText x={W - 24} y={H + 14} fontSize={10} fill="#AAA">{tMax.toFixed(0)}s</SvgText>
      <SvgText x={PAD} y={12} fontSize={10} fill="#AAA">{vMax.toFixed(1)}</SvgText>
    </Svg>
  );
}

// ── TimeToX ───────────────────────────────────────────────────────────────────
const ALL_PRESETS = [1, 2, 3, 5, 10, 15, 20, 25];

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

function TimeToX({ timeArr, distArr, baselineEndS, headWaistM = 0 }) {
  const { presets, maxReachableM } = React.useMemo(() => {
    if (!timeArr?.length || !distArr?.length || baselineEndS == null) {
      return { presets: ALL_PRESETS, maxReachableM: null };
    }
    const baseIdx = timeArr.findIndex(t => t >= baselineEndS);
    if (baseIdx < 0) return { presets: ALL_PRESETS, maxReachableM: null };
    const distBase = distArr[baseIdx] ?? 0;
    const distMax = distArr[distArr.length - 1] ?? 0;
    const maxM = Math.max(0, distMax - distBase - (headWaistM || 0));
    const visible = ALL_PRESETS.filter(p => p <= Math.ceil(maxM) + 1);
    return { presets: visible.length > 0 ? visible : ALL_PRESETS, maxReachableM: maxM };
  }, [timeArr, distArr, baselineEndS, headWaistM]);

  const defaultTarget = presets[Math.min(
    presets.length - 1,
    presets.findIndex(p => p >= 5) >= 0 ? presets.findIndex(p => p >= 5) : presets.length - 1,
  )];
  const [targetM, setTargetM] = React.useState(defaultTarget);

  React.useEffect(() => {
    if (!presets.includes(targetM)) setTargetM(presets[presets.length - 1]);
  }, [presets]);

  const timeToX = React.useMemo(
    () => computeTimeToX(timeArr, distArr, baselineEndS, headWaistM, targetM),
    [timeArr, distArr, baselineEndS, headWaistM, targetM],
  );

  return (
    <View style={{ alignItems: 'center' }}>
      <Text style={st.ttxValue}>{timeToX != null ? `${timeToX} s` : '--'}</Text>
      <Text style={st.ttxLabel}>to {targetM} m</Text>
      {maxReachableM != null && (
        <Text style={st.ttxMax}>Max from start: {maxReachableM.toFixed(1)} m</Text>
      )}
      <View style={st.ttxButtons}>
        {presets.map(p => (
          <TouchableOpacity
            key={p}
            style={[st.ttxBtn, targetM === p && st.ttxBtnActive]}
            onPress={() => setTargetM(p)}
          >
            <Text style={[st.ttxBtnText, targetM === p && st.ttxBtnTextActive]}>{p}m</Text>
          </TouchableOpacity>
        ))}
      </View>
    </View>
  );
}

// ── Styles ─────────────────────────────────────────────────────────────────────
const st = StyleSheet.create({
  container:       { flex: 1, backgroundColor: '#F5F7FA' },
  header:          { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, marginTop: 16, marginBottom: 8 },
  headerTitle:     { fontSize: 18, fontWeight: '700', color: '#1E3A5F' },
  back:            { fontSize: 14, color: '#2196F3' },
  dateLabel:       { fontSize: 13, color: '#7F8C8D', textAlign: 'center', marginBottom: 8 },
  sectionCard:     { backgroundColor: '#FFF', borderRadius: 12, padding: 14, marginBottom: 10 },
  sectionTitle:    { fontSize: 11, color: '#7F8C8D', fontWeight: '600', letterSpacing: 1, textTransform: 'uppercase', marginBottom: 10 },
  metricRow:       { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 8 },
  metricLabel:     { fontSize: 11, color: '#7F8C8D', textTransform: 'uppercase', letterSpacing: 0.5 },
  metricValue:     { fontSize: 22, fontWeight: '700', color: '#1E3A5F', marginTop: 2 },
  metricUnit:      { fontSize: 11, color: '#95A5A6' },
  chartTitle:      { fontSize: 11, fontWeight: '600', color: '#7F8C8D', marginTop: 4, marginBottom: 6, textTransform: 'uppercase', letterSpacing: 1 },
  noDetectText:    { fontSize: 13, color: '#95A5A6', fontStyle: 'italic', marginTop: 2 },
  ttxValue:        { fontSize: 42, fontWeight: '700', color: '#1E3A5F' },
  ttxLabel:        { fontSize: 14, color: '#7F8C8D', marginBottom: 4 },
  ttxMax:          { fontSize: 11, color: '#B0B8C4', marginBottom: 12 },
  ttxButtons:      { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 8, marginTop: 4 },
  ttxBtn:          { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 8, backgroundColor: '#F0F2F5', borderWidth: 1, borderColor: '#E0E4EA' },
  ttxBtnActive:    { backgroundColor: '#1E3A5F', borderColor: '#1E3A5F' },
  ttxBtnText:      { fontSize: 14, fontWeight: '600', color: '#7F8C8D' },
  ttxBtnTextActive:{ color: '#FFF' },
});
