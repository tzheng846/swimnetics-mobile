import React, { useRef, useState, useEffect, useCallback, useMemo } from 'react';
import {
  View, Text, TouchableOpacity, SafeAreaView, StyleSheet,
} from 'react-native';
import { useVideoPlayer, VideoView } from 'expo-video';
import VelocityChart from '../components/VelocityChart';
import { clampWindow } from '../lib/chartWindow';
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

// Phase 60 D5 — how much of the trace to show around the playhead. `null` = the whole thing,
// which is exactly the pre-60-03 behaviour. Presets rather than a slider: React Native dropped its
// built-in Slider at 0.60, so a continuous control means @react-native-community/slider — a native
// module, and therefore a fresh EAS build just to evaluate it.
const SPAN_PRESETS = [
  { label: '1s', span: 1 },
  { label: '2s', span: 2 },
  { label: '5s', span: 5 },
  { label: 'All', span: null },
];
const DEFAULT_SPAN_S = 2;

// ── Screen ─────────────────────────────────────────────────────────────────────
// Synced playback: tether_t = video currentTime + video_origin_s + manualOffsetS.
// END-ANCHOR: the camera and the device stop on the same tap, so their END phone times
// match. The video's first frame therefore sits at (deviceDuration − videoDuration) in the
// device timeline. This is warm-up-agnostic — unlike the old anchor (videoStartPhoneMs was
// stamped at the recordAsync() call, ~camera-warm-up before the first frame → ~2 s off).
export default function VideoOverlayScreen({ route, navigation }) {
  // `videoUri` is a local file:// path when we arrive from the record screen and a signed https
  // URL when we arrive from the report card (Phase 60 D4) — expo-video takes either.
  // `storedOriginS` is sessions.video_origin_s when the caller already knows it; null otherwise.
  const { time, velocity, videoUri, sessionId, storedOriginS = null } = route?.params ?? {};

  // Velocity arrays live in a ref — they never change and must not re-enter
  // effect deps at the ~20 Hz marker update rate.
  const dataRef = useRef({ time: time ?? [], velocity: velocity ?? [] });

  // Device recording duration (s) from the sample times.
  const deviceDurationS = time?.length ? time[time.length - 1] - time[0] : 0;
  // Video duration (s) — read from the player once it loads its metadata (async).
  const [videoDurationS, setVideoDurationS] = useState(null);
  // Null until the video duration is known (marker stays inert rather than guessing).
  const endAnchoredOriginS = videoDurationS != null ? deviceDurationS - videoDurationS : null;

  // ONE RULE, both entry points (Phase 60 D11, amended): use the stored origin if there is one,
  // otherwise compute it. There is deliberately no "which screen am I" flag — the record screen
  // never has a stored origin, so it computes and saves exactly as it always did, and the report
  // card usually does, so it reuses it instead of clobbering a nudge someone already dialled in.
  const effectiveOriginS = storedOriginS != null ? storedOriginS : endAnchoredOriginS;
  const [manualOffsetS, setManualOffsetS] = useState(0);
  const [markerTimeS, setMarkerTimeS] = useState(null);
  const [readoutVel, setReadoutVel] = useState(null);
  const [spanS, setSpanS] = useState(DEFAULT_SPAN_S);

  // Rolling window, CENTRED on the playhead — the coach needs the approach and the follow-through,
  // not only what has already happened. clampWindow's 'span' anchor gives the end behaviour for
  // free: near t=0 this becomes [0, span] rather than [-1, +1], preserving width instead of
  // shrinking. No new timer — the 20 Hz poll below already produces markerTimeS.
  const chartWindow = useMemo(() => {
    if (spanS == null || markerTimeS == null) return null;
    const t = dataRef.current.time;
    if (!t?.length) return null;
    return clampWindow(
      { tStart: markerTimeS - spanS / 2, tEnd: markerTimeS + spanS / 2 },
      t[0], t[t.length - 1], 'span',
    );
  }, [spanS, markerTimeS]);

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
      if (t == null || isNaN(t) || effectiveOriginS == null) return; // wait for an origin
      const tetherT = t + effectiveOriginS + manualOffsetS;
      setMarkerTimeS(prev => (prev === tetherT ? prev : tetherT));
      setReadoutVel(interpVelocity(dataRef.current.time, dataRef.current.velocity, tetherT));
    }, 50);
    return () => clearInterval(id);
  }, [player, effectiveOriginS, manualOffsetS]);

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
  // Skips the initial [manualOffsetS] run. This used to be done by testing originSavedOnceRef,
  // which coupled "the user nudged" to "the auto-post already ran" — so on any path that skips the
  // auto-post, the first nudge would have been silently swallowed.
  const nudgeMountRef = useRef(true);

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

  // Auto-post, once, ONLY when nothing is stored yet.
  // ⚠ NEVER OVERWRITE AN EXISTING ORIGIN. A stored value may already carry a nudge someone dialled
  // in; recomputing over it would silently replace good data with worse — the failure shape Phases
  // 51/52/57/58 each turned up. When it IS null the session is the background-upload case (the
  // queue posts the file and no origin), which reaches the web at origin 0, silently unsynced —
  // there is nothing to destroy, so writing can only help.
  useEffect(() => {
    if (storedOriginS != null) return;
    if (endAnchoredOriginS == null || !sessionId || originSavedOnceRef.current) return;
    originSavedOnceRef.current = true;
    saveOrigin(endAnchoredOriginS + manualOffsetS);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [endAnchoredOriginS, storedOriginS, sessionId, saveOrigin]);

  // Re-post (debounced) when the user nudges. This fires on EVERY path — a nudge is deliberate,
  // and it is the only way to repair a bad stored origin from the phone.
  useEffect(() => {
    if (nudgeMountRef.current) { nudgeMountRef.current = false; return; }
    if (effectiveOriginS == null || !sessionId) return;
    clearTimeout(originDebounceRef.current);
    originDebounceRef.current = setTimeout(() => saveOrigin(effectiveOriginS + manualOffsetS), 1000);
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
          window={chartWindow}
        />
      </View>

      {/* Two rows of near-identical pills sat unlabelled next to each other and read as one
          control. They do completely different things: WINDOW changes how much trace you see,
          SYNC moves the video against the trace. Each row now says which it is. */}

      {/* How much of the trace is visible. `All` passes window=null — exactly the pre-60-03 view. */}
      <View style={styles.ctrlRow}>
        <Text style={styles.ctrlLabel}>WINDOW</Text>
        <View style={styles.ctrlBtns}>
          {SPAN_PRESETS.map(p => {
            const on = spanS === p.span;
            return (
              <TouchableOpacity
                key={p.label}
                style={[styles.spanBtn, on && styles.spanBtnOn]}
                onPress={() => setSpanS(p.span)}
              >
                <Text style={[styles.spanBtnText, on && styles.spanBtnTextOn]}>{p.label}</Text>
              </TouchableOpacity>
            );
          })}
        </View>
      </View>

      {/* Where the video sits against the trace — corrects residual camera warm-up latency. */}
      <View style={styles.ctrlRow}>
        <Text style={styles.ctrlLabel}>SYNC</Text>
        <View style={styles.ctrlBtns}>
          {NUDGE_STEPS.map(step => (
            <TouchableOpacity key={step} style={styles.nudgeBtn} onPress={() => nudge(step)}>
              <Text style={styles.nudgeBtnText}>{step > 0 ? `+${step}` : step}s</Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>
      <Text style={styles.nudgeLabel}>
        Video shifted {manualOffsetS >= 0 ? '+' : ''}{manualOffsetS.toFixed(1)} s against the trace
      </Text>
      {/* Sync debug. Now names WHICH origin is in effect — with two possible sources (stored vs
          end-anchored recompute) a systematic offset is only diagnosable if you know which one
          produced it. If the overlay is consistently off by a fixed amount, report this line. */}
      <Text style={styles.debugLine}>
        origin {effectiveOriginS != null ? `${effectiveOriginS >= 0 ? '+' : ''}${effectiveOriginS.toFixed(2)} s` : '— (loading)'}
        {' '}({storedOriginS != null ? 'stored' : 'computed'})
        {'  ·  '}device {deviceDurationS.toFixed(1)} s
        {'  ·  '}video {videoDurationS != null ? videoDurationS.toFixed(1) : '—'} s
        {storedOriginS != null && endAnchoredOriginS != null
          ? `  ·  end-anchor would be ${endAnchoredOriginS >= 0 ? '+' : ''}${endAnchoredOriginS.toFixed(2)} s`
          : ''}
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
  // One labelled row per control: a fixed-width caption on the left, pills flushed right. Costs no
  // vertical space (the video is flex:1 and would give it up), and makes the two rows read as two
  // controls rather than one long strip of pills.
  ctrlRow:      { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, marginTop: 8 },
  ctrlLabel:    { width: 58, fontSize: 10, fontWeight: '700', letterSpacing: 0.8, color: colors.textSecondary },
  ctrlBtns:     { flex: 1, flexDirection: 'row', justifyContent: 'flex-end', gap: 6 },
  spanBtn:      { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8, backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: colors.border },
  spanBtnOn:    { backgroundColor: colors.primary, borderColor: colors.primary },
  spanBtnText:  { fontSize: 13, fontWeight: '600', color: colors.textSecondary },
  spanBtnTextOn:{ color: colors.white },
  nudgeBtn:     { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8, backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: colors.border },
  nudgeBtnText: { fontSize: 13, fontWeight: '600', color: colors.text },
  nudgeLabel:   { fontSize: 11, color: colors.textMuted, textAlign: 'center', marginTop: 6 },
  debugLine:    { fontSize: 10, color: colors.textMuted, textAlign: 'center', marginTop: 4 },
  statusText:   { fontSize: 15, color: colors.text, marginTop: 24, textAlign: 'center' },
  primaryBtn:   { backgroundColor: colors.primary, borderRadius: 12, paddingVertical: 14, paddingHorizontal: 36, marginTop: 12, alignSelf: 'center' },
  btnText:      { color: colors.white, fontSize: 16, fontWeight: '600' },
});
