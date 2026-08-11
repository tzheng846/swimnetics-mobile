import React, { useRef, useState, useEffect, useCallback } from 'react';
import {
  View, Text, TouchableOpacity, SafeAreaView, StyleSheet,
} from 'react-native';
import { useVideoPlayer, VideoView } from 'expo-video';
import VelocityChart from '../components/VelocityChart';
import { API_BASE } from '../config';
import { supabase } from '../lib/supabase';
import { colors } from '../theme';

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
// END-ANCHOR: the camera and the device stop on the same tap, so their END phone times
// match. The video's first frame therefore sits at (deviceDuration − videoDuration) in the
// device timeline. This is warm-up-agnostic — unlike the old anchor (videoStartPhoneMs was
// stamped at the recordAsync() call, ~camera-warm-up before the first frame → ~2 s off).
export default function VideoOverlayScreen({ route, navigation }) {
  const { time, velocity, videoUri, sessionId } = route?.params ?? {};

  // Velocity arrays live in a ref — they never change and must not re-enter
  // effect deps at the ~20 Hz marker update rate.
  const dataRef = useRef({ time: time ?? [], velocity: velocity ?? [] });

  // Device recording duration (s) from the sample times.
  const deviceDurationS = time?.length ? time[time.length - 1] - time[0] : 0;
  // Video duration (s) — read from the player once it loads its metadata (async).
  const [videoDurationS, setVideoDurationS] = useState(null);
  // Origin is null until the video duration is known (marker stays inert rather than guessing).
  const videoOriginS = videoDurationS != null ? deviceDurationS - videoDurationS : null;
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
      let t, dur;
      try {
        t = player.currentTime; // throws if the player was released mid-tick
        dur = player.duration;
      } catch {
        clearInterval(id);
        return;
      }
      // Capture the video duration once it loads — it drives the end-anchored origin.
      if (dur != null && !isNaN(dur) && dur > 0) {
        setVideoDurationS(prev => (prev === dur ? prev : dur));
      }
      if (t == null || isNaN(t) || videoOriginS == null) return; // wait for duration → origin
      const tetherT = t + videoOriginS + manualOffsetS;
      setMarkerTimeS(prev => (prev === tetherT ? prev : tetherT));
      setReadoutVel(interpVelocity(dataRef.current.time, dataRef.current.velocity, tetherT));
    }, 50);
    return () => clearInterval(id);
  }, [player, videoOriginS, manualOffsetS]);

  const nudge = (step) => {
    setManualOffsetS(o => Math.max(-NUDGE_LIMIT_S, Math.min(NUDGE_LIMIT_S, +(o + step).toFixed(1))));
  };

  // ── Cloud sync-origin save (Phase 47-03) ──────────────────────────────────────
  // Persist video_origin_s = end-anchored origin + manual nudge so the web annotate
  // page opens aligned. Origin-only POST — string-only FormData is Hermes-safe (the
  // known RN crash is the {uri,name,type} FILE pattern). No sessionId → no calls.
  const [syncSaveState, setSyncSaveState] = useState(null); // 'saved' | 'failed' | null
  const originSavedOnceRef = useRef(false);
  const originDebounceRef = useRef(null);

  const saveOrigin = useCallback(async (v) => {
    if (!sessionId) return;
    try {
      const { data } = await supabase.auth.getSession();
      const token = data?.session?.access_token;
      if (!token) throw new Error('Not signed in');
      const fd = new FormData();
      fd.append('video_origin_s', String(v));
      const resp = await fetch(`${API_BASE}/sessions/${sessionId}/video`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: fd,
      });
      if (!resp.ok) throw new Error(`API ${resp.status}`);
      setSyncSaveState('saved');
    } catch {
      setSyncSaveState('failed');
    }
  }, [sessionId]);

  // Post once as soon as the end-anchored origin is known.
  useEffect(() => {
    if (videoOriginS == null || !sessionId || originSavedOnceRef.current) return;
    originSavedOnceRef.current = true;
    saveOrigin(videoOriginS + manualOffsetS);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [videoOriginS, sessionId, saveOrigin]);

  // Re-post (debounced) when the user nudges the sync offset.
  useEffect(() => {
    if (!originSavedOnceRef.current || videoOriginS == null || !sessionId) return;
    clearTimeout(originDebounceRef.current);
    originDebounceRef.current = setTimeout(() => saveOrigin(videoOriginS + manualOffsetS), 1000);
    return () => clearTimeout(originDebounceRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [manualOffsetS]);

  if (!videoUri || !time?.length) {
    return (
      <SafeAreaView style={styles.container}>
        <Text style={styles.statusText}>
          {!videoUri ? 'No video file was provided.'
            : 'No session velocity data was provided.'}
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
      {/* Sync debug — origin = deviceDuration − videoDuration (end-anchored). If the overlay
          is consistently off by a fixed amount, this is the number to report */}
      <Text style={styles.debugLine}>
        origin {videoOriginS != null ? `${videoOriginS >= 0 ? '+' : ''}${videoOriginS.toFixed(2)} s` : '— (loading)'}
        {'  ·  '}device {deviceDurationS.toFixed(1)} s
        {'  ·  '}video {videoDurationS != null ? videoDurationS.toFixed(1) : '—'} s
        {syncSaveState === 'saved' ? '  ·  sync saved ✓' : syncSaveState === 'failed' ? '  ·  sync save failed' : ''}
      </Text>
    </SafeAreaView>
  );
}

// ── Styles ─────────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  container:    { flex: 1, backgroundColor: colors.bg },
  header:       { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, marginTop: 16, marginBottom: 8 },
  title:        { fontSize: 18, fontWeight: '700', color: colors.text },
  backText:     { fontSize: 14, color: colors.primary },
  // Height-driven, not aspect-driven. The footage is portrait (9:16), so a width-locked box
  // would be ~693pt tall on a 390pt screen and bury the chart. flex:1 hands the video whatever
  // the fixed rows below it (readout, 170pt chart, nudge, sync labels) do not use, and
  // contentFit="contain" pillarboxes inside that — so it adapts to any screen or clip shape.
  video:        { flex: 1, width: '100%', backgroundColor: '#000' },
  readoutRow:   { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'center', marginTop: 8 },
  readoutValue: { fontSize: 36, fontWeight: '700', color: colors.text },
  readoutUnit:  { fontSize: 14, color: colors.textMuted, marginLeft: 6 },
  chartWrap:    { paddingHorizontal: 24, marginTop: 4 },
  nudgeRow:     { flexDirection: 'row', justifyContent: 'center', gap: 10, marginTop: 8 },
  nudgeBtn:     { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 8, backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: colors.border },
  nudgeBtnText: { fontSize: 14, fontWeight: '600', color: colors.text },
  nudgeLabel:   { fontSize: 12, color: colors.textSecondary, textAlign: 'center', marginTop: 6 },
  debugLine:    { fontSize: 10, color: colors.textMuted, textAlign: 'center', marginTop: 4 },
  statusText:   { fontSize: 15, color: colors.text, marginTop: 24, textAlign: 'center' },
  primaryBtn:   { backgroundColor: colors.primary, borderRadius: 12, paddingVertical: 14, paddingHorizontal: 36, marginTop: 12, alignSelf: 'center' },
  btnText:      { color: colors.white, fontSize: 16, fontWeight: '600' },
});
