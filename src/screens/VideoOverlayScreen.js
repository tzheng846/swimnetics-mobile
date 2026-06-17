import React, { useRef, useState, useEffect } from 'react';
import {
  View, Text, TouchableOpacity, SafeAreaView, StyleSheet,
} from 'react-native';
import { useVideoPlayer, VideoView } from 'expo-video';
import VelocityChart from '../components/VelocityChart';

// ── Pure helper ────────────────────────────────────────────────────────────────
// Linear interpolation of velocity at tether time t. Returns null outside the
// session range or across null/NaN samples — the caller renders "---".
export function interpVelocity(time, velocity, t) {
  if (!time?.length || !velocity?.length || t == null || isNaN(t)) return null;
  if (t < time[0] || t > time[time.length - 1]) return null;
  let lo = 0;
  let hi = time.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (time[mid] <= t) lo = mid; else hi = mid;
  }
  const t0 = time[lo];
  const t1 = time[hi];
  const v0 = velocity[lo];
  const v1 = velocity[hi];
  if (v0 == null || v1 == null || isNaN(v0) || isNaN(v1)) return null;
  if (t1 === t0) return v0;
  return v0 + ((t - t0) / (t1 - t0)) * (v1 - v0);
}

const NUDGE_LIMIT_S = 3;
const NUDGE_STEPS = [-0.5, -0.1, 0.1, 0.5];

// ── Screen ─────────────────────────────────────────────────────────────────────
// Synced playback: tether_t = video currentTime + video_origin_s + manualOffsetS.
// video_origin_s comes from two phone-wall-clock anchors captured at record time
// (META-derived sessionStartPhoneMs, app-timestamped videoStartPhoneMs).
export default function VideoOverlayScreen({ route, navigation }) {
  const { time, velocity, sessionStartPhoneMs, videoUri, videoStartPhoneMs } = route?.params ?? {};

  // Velocity arrays live in a ref — they never change and must not re-enter
  // effect deps at the ~20 Hz marker update rate.
  const dataRef = useRef({ time: time ?? [], velocity: velocity ?? [] });

  // Guard the origin: a missing timestamp would make it NaN and silently kill
  // the marker/readout with no visible cause.
  const haveSyncAnchors = sessionStartPhoneMs != null && videoStartPhoneMs != null;
  const videoOriginS = haveSyncAnchors ? (sessionStartPhoneMs - videoStartPhoneMs) / 1000 : 0;
  const [manualOffsetS, setManualOffsetS] = useState(0);
  const [markerTimeS, setMarkerTimeS] = useState(null);
  const [readoutVel, setReadoutVel] = useState(null);

  const player = useVideoPlayer(videoUri, (p) => {
    p.loop = false;
  });

  // Poll player.currentTime at ~20 Hz instead of the timeUpdate event: the event
  // only fires during playback, so scrubbing while PAUSED would leave the marker
  // stale. Polling tracks play, pause, and scrub uniformly.
  useEffect(() => {
    const id = setInterval(() => {
      let t;
      try {
        t = player.currentTime; // throws if the player was released mid-tick
      } catch {
        clearInterval(id);
        return;
      }
      if (t == null || isNaN(t)) return;
      const tetherT = t + videoOriginS + manualOffsetS;
      setMarkerTimeS(prev => (prev === tetherT ? prev : tetherT));
      setReadoutVel(interpVelocity(dataRef.current.time, dataRef.current.velocity, tetherT));
    }, 50);
    return () => clearInterval(id);
  }, [player, videoOriginS, manualOffsetS]);

  const nudge = (step) => {
    setManualOffsetS(o => Math.max(-NUDGE_LIMIT_S, Math.min(NUDGE_LIMIT_S, +(o + step).toFixed(1))));
  };

  if (!videoUri || !time?.length || !haveSyncAnchors) {
    return (
      <SafeAreaView style={styles.container}>
        <Text style={styles.statusText}>
          {!videoUri ? 'No video file was provided.'
            : !time?.length ? 'No session velocity data was provided.'
            : 'Missing sync timestamps — cannot align video and session.'}
        </Text>
        <TouchableOpacity style={styles.primaryBtn} onPress={() => navigation.goBack()}>
          <Text style={styles.btnText}>‹ Back</Text>
        </TouchableOpacity>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
          <Text style={styles.backText}>‹ Results</Text>
        </TouchableOpacity>
        <Text style={styles.title}>Video Overlay</Text>
        <View style={{ width: 56 }} />
      </View>

      <VideoView player={player} style={styles.video} contentFit="contain" nativeControls />

      <View style={styles.readoutRow}>
        <Text style={styles.readoutValue}>
          {readoutVel != null ? readoutVel.toFixed(2) : '---'}
        </Text>
        <Text style={styles.readoutUnit}>m/s</Text>
      </View>

      <View style={styles.chartWrap}>
        <VelocityChart
          time={dataRef.current.time}
          velocity={dataRef.current.velocity}
          markerTimeS={markerTimeS}
          markerLabel=""
        />
      </View>

      {/* Sync nudge — corrects the small fixed camera warm-up latency */}
      <View style={styles.nudgeRow}>
        {NUDGE_STEPS.map(step => (
          <TouchableOpacity key={step} style={styles.nudgeBtn} onPress={() => nudge(step)}>
            <Text style={styles.nudgeBtnText}>{step > 0 ? `+${step}` : step}s</Text>
          </TouchableOpacity>
        ))}
      </View>
      <Text style={styles.nudgeLabel}>
        Sync offset: {manualOffsetS >= 0 ? '+' : ''}{manualOffsetS.toFixed(1)} s
      </Text>
      {/* Sync debug — origin is the computed metadata alignment; if the overlay is
          consistently off by a fixed amount, this is the number to report */}
      <Text style={styles.debugLine}>
        origin {videoOriginS >= 0 ? '+' : ''}{videoOriginS.toFixed(2)} s
        {'  ·  '}session start {new Date(sessionStartPhoneMs).toISOString().slice(11, 23)}
        {'  ·  '}video start {new Date(videoStartPhoneMs).toISOString().slice(11, 23)}
      </Text>
    </SafeAreaView>
  );
}

// ── Styles ─────────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  container:    { flex: 1, backgroundColor: '#F5F7FA' },
  header:       { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, marginTop: 16, marginBottom: 8 },
  title:        { fontSize: 18, fontWeight: '700', color: '#1E3A5F' },
  backText:     { fontSize: 14, color: '#2196F3' },
  video:        { width: '100%', aspectRatio: 3 / 4, backgroundColor: '#000' },
  readoutRow:   { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'center', marginTop: 8 },
  readoutValue: { fontSize: 36, fontWeight: '700', color: '#1E3A5F' },
  readoutUnit:  { fontSize: 14, color: '#95A5A6', marginLeft: 6 },
  chartWrap:    { paddingHorizontal: 24, marginTop: 4 },
  nudgeRow:     { flexDirection: 'row', justifyContent: 'center', gap: 10, marginTop: 8 },
  nudgeBtn:     { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 8, backgroundColor: '#F0F2F5', borderWidth: 1, borderColor: '#E0E4EA' },
  nudgeBtnText: { fontSize: 14, fontWeight: '600', color: '#1E3A5F' },
  nudgeLabel:   { fontSize: 12, color: '#7F8C8D', textAlign: 'center', marginTop: 6 },
  debugLine:    { fontSize: 10, color: '#B0B8C4', textAlign: 'center', marginTop: 4 },
  statusText:   { fontSize: 15, color: '#2C3E50', marginTop: 24, textAlign: 'center' },
  primaryBtn:   { backgroundColor: '#1E3A5F', borderRadius: 12, paddingVertical: 14, paddingHorizontal: 36, marginTop: 12, alignSelf: 'center' },
  btnText:      { color: '#FFF', fontSize: 16, fontWeight: '600' },
});
