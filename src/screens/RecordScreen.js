import React, { useRef, useState, useEffect, useCallback } from 'react';
import {
  View, Text, TouchableOpacity,
  ActivityIndicator, SafeAreaView, StyleSheet,
  ScrollView, Alert,
} from 'react-native';
import * as FileSystem from 'expo-file-system/legacy';
import { Buffer } from 'buffer';
import VelocityChart from '../components/VelocityChart';
import { API_BASE } from '../config';
import { useAuth } from '../context/AuthContext';
import { useBle } from '../context/BleContext';
import DataQualityCard from '../components/DataQualityCard';

// ── BLE constants ─────────────────────────────────────────────────────────────
const NUS_SERVICE = '6E400001-B5A3-F393-E0A9-E50E24DCCA9E';
const NUS_TX_CHAR = '6E400003-B5A3-F393-E0A9-E50E24DCCA9E'; // device → phone (notify)
const NUS_RX_CHAR = '6E400002-B5A3-F393-E0A9-E50E24DCCA9E'; // phone → device (write)

// Buffer-and-dump protocol (firmware 1.1.0):
//   META response = exactly 8 bytes [session_start_us u32 LE][device_now_us u32 LE]
//   End-of-dump marker = exactly 1 byte 0xEE
//   Sample packets = any non-zero multiple of 7 bytes
const META_SIZE = 8;
const END_OF_DUMP_MARKER = 0xEE;
const RETRIEVAL_STALL_MS = 30000;

// ── Packet parser ─────────────────────────────────────────────────────────────
// Sample: [uint32 timestamp_us LE][uint16 angle_counts LE][uint8 magnet_ok]
function parsePacket(base64) {
  if (!base64) return { samples: [], error: 'null value from characteristic' };
  let buf;
  try {
    buf = Buffer.from(base64, 'base64');
  } catch (e) {
    return { samples: [], error: `base64 decode failed: ${e.message}` };
  }
  if (buf.length === 0) return { samples: [], error: 'empty buffer' };
  // Each sample is 7 bytes: [uint32 ts_us][uint16 angle][uint8 magnet_ok].
  // Accept any packet that is a non-zero multiple of 7.
  if (buf.length % 7 !== 0) {
    return { samples: [], error: `unexpected length ${buf.length} (expected multiple of 7)` };
  }
  const numSamples = buf.length / 7;
  const samples = Array.from({ length: numSamples }, (_, i) => ({
    timestamp_us: buf.readUInt32LE(i * 7),
    angle_counts: buf.readUInt16LE(i * 7 + 4),
    magnet_ok: buf.readUInt8(i * 7 + 6),
  }));
  return { samples, error: null };
}

// ── Component ─────────────────────────────────────────────────────────────────
export default function RecordScreen({ route, navigation }) {
  const { athleteId, athleteName, strokeType = 'breaststroke', headWaistM = 0, sessionName = null, sessionNotes = null } = route?.params ?? {};
  useEffect(() => { navigation.setOptions({ gestureEnabled: false }); }, []);

  const { session, signOut } = useAuth();
  const sessionRef = useRef(session);
  useEffect(() => { sessionRef.current = session; }, [session]);

  const { connectedDevice, connectionStatus, knownDevices } = useBle();
  const deviceRef = useRef(connectedDevice);
  useEffect(() => { deviceRef.current = connectedDevice; }, [connectedDevice]);
  const chipId = knownDevices.find(d => d.bleId === connectedDevice?.id)?.chipId ?? null;

  // 'ready' | 'recording' | 'retrieving' | 'saving' | 'uploading' | 'results' | 'error'
  const [bleState, setBleState] = useState('ready');
  const [sampleCount, setSampleCount] = useState(0);
  const [savedPath, setSavedPath]     = useState(null);
  const [apiResult, setApiResult]     = useState(null);
  const [elapsedS, setElapsedS]       = useState(0);
  const [sessionStartPhoneMs, setSessionStartPhoneMs] = useState(null);

  const subscriptionRef = useRef(null);
  const samplesRef      = useRef([]);
  const isStoppingRef   = useRef(false);
  const stallTimerRef   = useRef(null);
  const metaSeenRef     = useRef(false);
  const dumpDoneRef     = useRef(false);
  const elapsedTimerRef = useRef(null);
  const bleStateRef     = useRef('ready');
  useEffect(() => { bleStateRef.current = bleState; }, [bleState]);

  const [markerTimeS, setMarkerTimeS] = useState(null);
  const [markerLabel, setMarkerLabel] = useState('');
  const [unit, setUnit] = useState('metric');

  const unitFactor = unit === 'imperial' ? 1.09361 : 1;
  const distUnit   = unit === 'imperial' ? 'yd' : 'm';
  const velUnit    = unit === 'imperial' ? 'yd/s' : 'm/s';
  const fmtDist    = (val) => val != null ? (val * unitFactor).toFixed(1) : null;
  const fmtVel     = (val) => val != null ? (val * unitFactor).toFixed(2) : null;
  const efficiencyUnreliable = (apiResult?.session?.cv_isi ?? 0) > 0.80;

  const log = useCallback((msg, level = 'info') => {
    console.log(`[${level.toUpperCase()}] ${msg}`);
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      subscriptionRef.current?.remove();
      clearTimeout(stallTimerRef.current);
      clearInterval(elapsedTimerRef.current);
    };
  }, []);

  // Mid-flow disconnect (context-level watcher) — device retains its buffer,
  // so the user can reconnect and Retrieve again.
  useEffect(() => {
    if (connectionStatus !== 'connected'
        && (bleStateRef.current === 'recording' || bleStateRef.current === 'retrieving')) {
      subscriptionRef.current?.remove();
      subscriptionRef.current = null;
      clearTimeout(stallTimerRef.current);
      clearInterval(elapsedTimerRef.current);
      log('Device disconnected mid-flow — session is retained on the device', 'warn');
      setBleState('error');
    }
  }, [connectionStatus, log]);

  // ── BLE write helper ──────────────────────────────────────────────────────────
  const writeCmd = useCallback(async (cmd) => {
    await Promise.race([
      deviceRef.current.writeCharacteristicWithResponseForService(
        NUS_SERVICE, NUS_RX_CHAR,
        Buffer.from(cmd + '\n').toString('base64'),
      ),
      new Promise((_, reject) => setTimeout(() => reject(new Error('write timeout')), 3000)),
    ]);
  }, []);

  // ── Save CSV ─────────────────────────────────────────────────────────────────
  const saveCSV = useCallback(async (samples) => {
    log(`Saving ${samples.length} samples to CSV...`);
    const header = 'timestamp_us,angle_counts,magnet_ok\n';
    const rows   = samples.map(s => `${s.timestamp_us},${s.angle_counts},${s.magnet_ok}`).join('\n');
    const filename = `session_${Date.now()}.csv`;
    const path = FileSystem.documentDirectory + filename;
    await FileSystem.writeAsStringAsync(path, header + rows, {
      encoding: FileSystem.EncodingType.UTF8,
    });
    log(`Saved: ${filename}`, 'ok');
    return { path, count: samples.length };
  }, [log]);

  // ── Upload to FastAPI ─────────────────────────────────────────────────────────
  // Uses FileSystem.uploadAsync (native multipart) instead of fetch + FormData
  // because RN 0.85/Hermes rejects the {uri, name, type} FormData pattern with
  // "Unsupported FormData implementation".
  const uploadAndProcess = useCallback(async (filePath) => {
    setBleState('uploading');
    log(`Uploading — athlete_id: ${athleteId ?? 'none'}, device_id: ${chipId ?? 'none'}`);
    try {
      const authHeaders = sessionRef.current?.access_token
        ? { Authorization: `Bearer ${sessionRef.current.access_token}` }
        : {};
      const parameters = { head_waist_m: String(headWaistM), stroke_type: strokeType };
      if (athleteId)    parameters.athlete_id = String(athleteId);
      if (sessionName)  parameters.name       = sessionName;
      if (sessionNotes) parameters.notes      = sessionNotes;
      if (chipId)       parameters.device_id  = chipId;

      const result = await FileSystem.uploadAsync(`${API_BASE}/process`, filePath, {
        httpMethod: 'POST',
        uploadType: FileSystem.FileSystemUploadType.MULTIPART,
        fieldName: 'file',
        mimeType: 'text/csv',
        headers: authHeaders,
        parameters,
      });

      if (result.status === 402) {
        let msg = 'You have reached a plan limit.';
        try { msg = JSON.parse(result.body).detail || msg; } catch {}
        Alert.alert('Plan Limit Reached', msg + '\n\nVisit swimnetics.com to upgrade.', [{ text: 'OK' }]);
        setBleState('error');
        return;
      }
      if (result.status < 200 || result.status >= 300) {
        throw new Error(`API ${result.status}: ${result.body.slice(0, 120)}`);
      }

      const data = JSON.parse(result.body);
      log(`Upload complete. Stroke rate: ${data.session?.stroke_rate_spm?.toFixed(1)} SPM`, 'ok');
      setApiResult(data);
      setBleState('results');
    } catch (e) {
      log(`Upload failed: ${e.message}`, 'error');
      setBleState('error');
    }
  }, [log, athleteId, headWaistM, strokeType, sessionName, sessionNotes, chipId]);

  // ── Retrieval (META → clock correlation → DUMP → save/upload) ────────────────
  const finishRetrieval = useCallback(async (stalled = false) => {
    subscriptionRef.current?.remove();
    subscriptionRef.current = null;
    clearTimeout(stallTimerRef.current);

    const captured = [...samplesRef.current];
    log(`Retrieval ${stalled ? 'STALLED' : 'complete'} — ${captured.length} samples`);
    if (captured.length === 0) {
      Alert.alert('Nothing Retrieved', 'No samples were received from the device.');
      setBleState('ready');
      return;
    }
    if (stalled) {
      Alert.alert('Retrieval Incomplete',
        'The end-of-dump marker never arrived. Saving what was received.');
    }

    setBleState('saving');
    try {
      const { path } = await saveCSV(captured);
      setSavedPath(path);
      uploadAndProcess(path); // fire-and-forget — manages its own state transitions
    } catch (e) {
      log(`Save failed: ${e.message}`, 'error');
      setBleState('error');
    }
  }, [log, saveCSV, uploadAndProcess]);

  const runRetrieval = useCallback(async () => {
    samplesRef.current = [];
    metaSeenRef.current = false;
    dumpDoneRef.current = false;
    setSampleCount(0);
    setSavedPath(null);
    setSessionStartPhoneMs(null);
    setBleState('retrieving');
    log('Starting retrieval (META → DUMP)...');

    const resetStallTimer = () => {
      clearTimeout(stallTimerRef.current);
      stallTimerRef.current = setTimeout(() => {
        if (!dumpDoneRef.current) finishRetrieval(true);
      }, RETRIEVAL_STALL_MS);
    };

    try {
      // Subscribe FIRST — before sending any command (locked pattern)
      subscriptionRef.current = deviceRef.current.monitorCharacteristicForService(
        NUS_SERVICE, NUS_TX_CHAR,
        (error, characteristic) => {
          if (error) {
            // Code 2 = OperationCancelled — expected when retrieval removes the subscription
            if (error.errorCode === 2) return;
            log(`Notification error: ${error.message} (code: ${error.errorCode})`, 'error');
            return;
          }
          if (!characteristic?.value) return;
          const buf = Buffer.from(characteristic.value, 'base64');
          resetStallTimer();

          // META response — exactly 8 bytes (not a multiple of 7)
          if (buf.length === META_SIZE && !metaSeenRef.current) {
            metaSeenRef.current = true;
            const phoneNowMs     = Date.now();
            const sessionStartUs = buf.readUInt32LE(0);
            const deviceNowUs    = buf.readUInt32LE(4);

            if (sessionStartUs === 0) {
              log('META: no session buffered on device', 'warn');
              subscriptionRef.current?.remove();
              subscriptionRef.current = null;
              clearTimeout(stallTimerRef.current);
              Alert.alert('No Session', 'The device has no recorded session to retrieve.');
              setBleState('ready');
              return;
            }

            // uint32 modular subtraction — device clock (micros) wraps at 2^32
            const elapsedUs = (deviceNowUs - sessionStartUs + 2 ** 32) % 2 ** 32;
            const startPhoneMs = phoneNowMs - elapsedUs / 1000;
            setSessionStartPhoneMs(startPhoneMs);
            log(`META: session started ${(elapsedUs / 1e6).toFixed(2)} s ago — `
                + `sessionStartPhoneMs=${startPhoneMs.toFixed(0)} `
                + `(${new Date(startPhoneMs).toISOString()})`, 'ok');

            writeCmd('DUMP').catch(e => {
              log(`DUMP write failed: ${e.message}`, 'error');
              finishRetrieval(true);
            });
            return;
          }

          // End-of-dump marker — exactly 1 byte 0xEE
          if (buf.length === 1 && buf[0] === END_OF_DUMP_MARKER) {
            dumpDoneRef.current = true;
            finishRetrieval(false);
            return;
          }

          // Sample packets — any non-zero multiple of 7 bytes
          const { samples, error: parseError } = parsePacket(characteristic.value);
          if (parseError) return; // META duplicates / unknown packets — ignore
          samplesRef.current.push(...samples);
          setSampleCount(c => c + samples.length);
        },
      );

      resetStallTimer();
      await writeCmd('META');
      log('META sent', 'ok');
    } catch (e) {
      log(`Retrieval failed to start: ${e.message}`, 'error');
      subscriptionRef.current?.remove();
      subscriptionRef.current = null;
      clearTimeout(stallTimerRef.current);
      setBleState('error');
    }
  }, [log, writeCmd, finishRetrieval]);

  // ── Remote record (device buffers; data arrives at retrieval) ────────────────
  const startRecording = useCallback(async () => {
    isStoppingRef.current = false;
    setSavedPath(null);
    setApiResult(null);
    try {
      await writeCmd('START');
      log('START sent — device is buffering', 'ok');
      setElapsedS(0);
      const t0 = Date.now();
      elapsedTimerRef.current = setInterval(
        () => setElapsedS(Math.floor((Date.now() - t0) / 1000)), 1000);
      setBleState('recording');
    } catch (e) {
      log(`START failed: ${e.message}`, 'error');
      Alert.alert('Start Failed', e.message ?? 'Could not start recording.');
    }
  }, [log, writeCmd]);

  const stopRecording = useCallback(async () => {
    if (isStoppingRef.current) { log('stopRecording called twice — ignoring', 'warn'); return; }
    isStoppingRef.current = true;
    clearInterval(elapsedTimerRef.current);
    try {
      await writeCmd('STOP');
      log('STOP sent', 'ok');
    } catch (e) {
      log(`STOP failed (non-fatal): ${e.message}`, 'warn');
    }
    runRetrieval(); // device holds the buffer — retrieve it now
  }, [log, writeCmd, runRetrieval]);

  // ── Reset ─────────────────────────────────────────────────────────────────────
  const reset = useCallback(() => {
    subscriptionRef.current?.remove();
    subscriptionRef.current = null;
    clearTimeout(stallTimerRef.current);
    clearInterval(elapsedTimerRef.current);
    samplesRef.current = [];
    isStoppingRef.current = false;
    setSampleCount(0);
    setSavedPath(null);
    setApiResult(null);
    setMarkerTimeS(null);
    setMarkerLabel('');
    setSessionStartPhoneMs(null);
    setElapsedS(0);
    log('--- Reset ---');
    setBleState('ready'); // connection lives in BleContext — nothing to rescan
  }, [log]);

  const fmtElapsed = (s) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;

  const deviceLabel = connectedDevice?.name ?? 'SwimLogger';
  const notConnected = connectionStatus !== 'connected';
  const preResultState = ['ready', 'recording', 'retrieving'].includes(bleState);

// ── Render ────────────────────────────────────────────────────────────────────
  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
          <Text style={styles.backText}>‹ Athletes</Text>
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <Text style={styles.title}>Swimnetics</Text>
          {athleteName ? <Text style={styles.athleteLabel}>{athleteName}</Text> : null}
        </View>
        <TouchableOpacity onPress={signOut}>
          <Text style={styles.signOutText}>Sign Out</Text>
        </TouchableOpacity>
      </View>

      <View style={{ flex: 1 }}>
      {/* Device not connected — connection is managed in Config/Devices screens */}
      {notConnected && preResultState && (
        <View style={styles.statusArea}>
          <Text style={[styles.statusText, { color: '#C0392B' }]}>⚠ Device not connected</Text>
          <Text style={styles.hintText}>
            Reconnect from the previous screen. A session recorded on the device is retained
            and can be retrieved after reconnecting.
          </Text>
          <TouchableOpacity style={styles.primaryBtn} onPress={() => navigation.goBack()}>
            <Text style={styles.btnText}>‹ Back</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* STATUS AREA — hidden during results to avoid wasting space */}
      {!(notConnected && preResultState) && bleState !== 'results' && <View style={styles.statusArea}>
        {bleState === 'ready' && (
          <>
            <Text style={[styles.statusText, { color: '#27AE60' }]}>✓ {deviceLabel} connected</Text>
            <TouchableOpacity style={styles.primaryBtn} onPress={startRecording}>
              <Text style={styles.btnText}>Start Recording</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.secondaryBtn} onPress={runRetrieval}>
              <Text style={styles.secondaryBtnText}>Retrieve from Device</Text>
            </TouchableOpacity>
            <Text style={styles.hintText}>
              Retrieve a session the swimmer recorded with the device button.
            </Text>
          </>
        )}

        {bleState === 'recording' && (
          <>
            <Text style={styles.counterLabel}>Recording on device</Text>
            <Text style={styles.counter}>{fmtElapsed(elapsedS)}</Text>
            <Text style={styles.hintText}>
              Data is buffered on the device and retrieved after stopping.
            </Text>
            <TouchableOpacity style={styles.stopBtn} onPress={stopRecording}>
              <Text style={styles.btnText}>Stop Recording</Text>
            </TouchableOpacity>
          </>
        )}

        {bleState === 'retrieving' && (
          <>
            <View style={styles.row}>
              <ActivityIndicator color="#1E3A5F" />
              <Text style={styles.statusText}> Retrieving session…</Text>
            </View>
            <Text style={styles.counterLabel}>Samples</Text>
            <Text style={styles.counter}>{sampleCount.toLocaleString()}</Text>
          </>
        )}

        {bleState === 'saving' && (
          <View style={styles.row}>
            <ActivityIndicator color="#1E3A5F" />
            <Text style={styles.statusText}> Saving...</Text>
          </View>
        )}

        {bleState === 'uploading' && (
          <View style={styles.row}>
            <ActivityIndicator color="#1E3A5F" />
            <Text style={styles.statusText}> Processing session...</Text>
          </View>
        )}

        {bleState === 'error' && (
          <>
            <Text style={[styles.statusText, { color: '#C0392B', marginBottom: 4 }]}>
              ⚠ Recording error
            </Text>
            {savedPath && <Text style={styles.pathText}>{savedPath.split('/').pop()}</Text>}
            <Text style={styles.hintText}>
              If the device still holds the session, reconnect and tap Retrieve from Device.
            </Text>
            <TouchableOpacity style={styles.primaryBtn} onPress={reset}>
              <Text style={styles.btnText}>Try Again</Text>
            </TouchableOpacity>
          </>
        )}
      </View>}

      {/* RESULTS */}
      {bleState === 'results' && apiResult && (
        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 24 }}>

          {/* ── Dive / Pulldown ── */}
          <View style={styles.sectionCard}>
            <Text style={styles.sectionTitle}>Start Phase</Text>
            {apiResult.initial_phase?.dive_detected ? (
              <View style={styles.metricRow}>
                <MetricItem label="Dive Duration" value={apiResult.initial_phase.dive_duration_s?.toFixed(2)} unit="s" />
                <MetricItem label="Pulldown Peak" value={fmtVel(apiResult.initial_phase.pulldown_peak_vel_ms)} unit={velUnit} />
                <MetricItem label="Pulldown Time" value={apiResult.initial_phase.pulldown_duration_s?.toFixed(2)} unit="s" />
              </View>
            ) : (
              <Text style={styles.noDetectText}>
                {apiResult.initial_phase?.pulldown_detected
                  ? 'Pulldown detected — no dive surge'
                  : 'Wall start — no dive or pulldown'}
              </Text>
            )}
          </View>

          {/* ── Session ── */}
          <View style={styles.sectionCard}>
            <Text style={styles.sectionTitle}>Session</Text>
            <View style={styles.metricRow}>
              <MetricItem label="Lap Time"     value={apiResult.session?.lap_time_s?.toFixed(2)}          unit="s" />
              <MetricItem label="Distance"     value={fmtDist(apiResult.session?.total_dist_m)}            unit={distUnit} />
              <MetricItem label="Active Rate"  value={apiResult.session?.stroke_rate_spm?.toFixed(1)}      unit="SPM" />
            </View>
            <View style={styles.metricRow}>
              <MetricItem label="Strokes"      value={apiResult.session?.stroke_count}                     unit="" />
              <MetricItem label="Avg Speed"    value={fmtVel(apiResult.session?.mean_vel_ms)}              unit={velUnit} />
              <MetricItem label="Max Speed"    value={fmtVel(apiResult.session?.max_vel_ms)}               unit={velUnit} />
            </View>
          </View>

          {/* ── Efficiency ── */}
          <View style={styles.sectionCard}>
            <Text style={styles.sectionTitle}>Efficiency</Text>
            {efficiencyUnreliable ? (
              <Text style={styles.unreliableWarn}>
                Stroke detection may be unreliable for this session.{'\n'}
                Check recording conditions or technique consistency.
              </Text>
            ) : (
              <>
                <View style={styles.metricRow}>
                  <MetricItem label="Dist/Stroke"  value={fmtDist(apiResult.session?.mean_dps_m)}                          unit={distUnit} />
                  <MetricItem label="Impulse"      value={fmtDist(apiResult.session?.mean_impulse_m)}                       unit={distUnit} />
                  <MetricItem label="Coast"        value={apiResult.session?.mean_coast_fraction != null ? (apiResult.session.mean_coast_fraction * 100).toFixed(1) : null} unit="%" />
                </View>
                <View style={styles.metricRow}>
                  <MetricItem label="ISI CV"       value={apiResult.session?.cv_isi != null ? (apiResult.session.cv_isi * 100).toFixed(1) : null}             unit="%" />
                  <MetricItem label="Arm Peak CV"  value={apiResult.session?.cv_arm_peak_vel != null ? (apiResult.session.cv_arm_peak_vel * 100).toFixed(1) : null} unit="%" />
                  <MetricItem label="Fatigue"      value={apiResult.session?.fatigue_index_pct?.toFixed(1)}                unit="%" />
                </View>
              </>
            )}
          </View>

          {/* ── Velocity Chart ── */}
          <View style={styles.chartHeader}>
            <Text style={styles.chartTitle}>Velocity</Text>
            <View style={styles.unitToggle}>
              <TouchableOpacity
                style={[styles.unitBtn, unit === 'metric' && styles.unitBtnActive]}
                onPress={() => setUnit('metric')}
              >
                <Text style={[styles.unitBtnText, unit === 'metric' && styles.unitBtnTextActive]}>m</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.unitBtn, unit === 'imperial' && styles.unitBtnActive]}
                onPress={() => setUnit('imperial')}
              >
                <Text style={[styles.unitBtnText, unit === 'imperial' && styles.unitBtnTextActive]}>yd</Text>
              </TouchableOpacity>
            </View>
          </View>
          <VelocityChart
            time={apiResult.time}
            velocity={apiResult.velocity}
            markerTimeS={markerTimeS}
            markerLabel={markerLabel}
            unitFactor={unitFactor}
            unitLabel={velUnit}
            interactive
          />

          {/* ── Time to Distance ── */}
          <View style={styles.sectionCard}>
            <Text style={styles.sectionTitle}>Time to Distance</Text>
            <TimeToX
              timeArr={apiResult.time}
              distArr={apiResult.distance}
              baselineEndS={apiResult.session?.baseline_end_s}
              headWaistM={headWaistM}
              onMarkerChange={(tS, lbl) => { setMarkerTimeS(tS); setMarkerLabel(lbl); }}
              unit={unit}
            />
          </View>

          {/* ── Data Quality ── */}
          <DataQualityCard dataQuality={apiResult.data_quality} />

          {/* ── Sync reference (video overlay) ── */}
          {sessionStartPhoneMs != null && (
            <Text style={styles.syncLine}>
              Session start (phone clock): {new Date(sessionStartPhoneMs).toISOString()}
            </Text>
          )}

          {/* ── Save status ── */}
          <Text style={[styles.saveStatus, apiResult.athlete_id_received ? styles.saveOk : styles.saveWarn]}>
            {apiResult.athlete_id_received
              ? apiResult.session_save_error
                ? `⚠ Save failed: ${apiResult.session_save_error}`
                : '✓ Session saved to cloud'
              : '⚠ No athlete linked — session not saved'}
          </Text>

          <TouchableOpacity style={[styles.primaryBtn, { marginTop: 8 }]} onPress={reset}>
            <Text style={styles.btnText}>Record Again</Text>
          </TouchableOpacity>

        </ScrollView>
      )}
      </View>

    </SafeAreaView>
  );
}

// ── MetricItem ─────────────────────────────────────────────────────────────────
function MetricItem({ label, value, unit }) {
  return (
    <View style={{ alignItems: 'center', flex: 1 }}>
      <Text style={styles.metricLabel}>{label}</Text>
      <Text style={styles.metricValue}>{value ?? '--'}</Text>
      {unit ? <Text style={styles.metricUnit}>{unit}</Text> : null}
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
    [timeArr, distArr, baselineEndS, headWaistM, targetMeters]
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
      <Text style={styles.ttxValue}>{timeToX != null ? `${timeToX} s` : '--'}</Text>
      <Text style={styles.ttxLabel}>to {targetVal} {unitSuffix}</Text>
      {maxDisplay != null && (
        <Text style={styles.ttxMax}>Max from start: {maxDisplay}</Text>
      )}
      <View style={styles.ttxButtons}>
        {presets.map(p => (
          <TouchableOpacity
            key={p}
            style={[styles.ttxBtn, targetVal === p && styles.ttxBtnActive]}
            onPress={() => setTargetVal(p)}
          >
            <Text style={[styles.ttxBtnText, targetVal === p && styles.ttxBtnTextActive]}>
              {p}{unitSuffix}
            </Text>
          </TouchableOpacity>
        ))}
      </View>
    </View>
  );
}

// ── Styles ─────────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  container:    { flex: 1, backgroundColor: '#F5F7FA' },
  header:       { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, marginTop: 16, marginBottom: 8 },
  headerCenter: { flex: 1, alignItems: 'center' },
  title:        { fontSize: 22, fontWeight: '700', color: '#1E3A5F' },
  backText:     { fontSize: 14, color: '#2196F3' },
  signOutText:  { fontSize: 13, color: '#888' },
  athleteLabel: { fontSize: 13, color: '#2196F3', marginTop: 2, textAlign: 'center' },
  statusArea:   { alignItems: 'center', paddingHorizontal: 24, minHeight: 160 },
  row:          { flexDirection: 'row', alignItems: 'center', marginTop: 16 },
  primaryBtn:   { backgroundColor: '#1E3A5F', borderRadius: 12, paddingVertical: 14, paddingHorizontal: 36, marginTop: 12 },
  secondaryBtn: { borderColor: '#1E3A5F', borderWidth: 1, borderRadius: 12, paddingVertical: 12, paddingHorizontal: 28, marginTop: 12 },
  secondaryBtnText: { color: '#1E3A5F', fontSize: 15, fontWeight: '600' },
  stopBtn:      { backgroundColor: '#C0392B', borderRadius: 12, paddingVertical: 14, paddingHorizontal: 36, marginTop: 20 },
  btnText:      { color: '#FFF', fontSize: 16, fontWeight: '600' },
  statusText:   { fontSize: 15, color: '#2C3E50', marginTop: 12, textAlign: 'center' },
  hintText:     { fontSize: 12, color: '#95A5A6', marginTop: 8, textAlign: 'center', lineHeight: 17 },
  counterLabel: { fontSize: 14, color: '#7F8C8D', marginTop: 20 },
  counter:      { fontSize: 56, fontWeight: '700', color: '#1E3A5F' },
  pathText:     { fontSize: 12, color: '#95A5A6', marginTop: 4, textAlign: 'center' },
  sectionCard:  { backgroundColor: '#FFF', borderRadius: 12, padding: 14, marginBottom: 10 },
  sectionTitle: { fontSize: 11, color: '#7F8C8D', fontWeight: '600', letterSpacing: 1, textTransform: 'uppercase', marginBottom: 10 },
  metricRow:    { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 8 },
  metricLabel:  { fontSize: 11, color: '#7F8C8D', textTransform: 'uppercase', letterSpacing: 0.5 },
  metricValue:  { fontSize: 22, fontWeight: '700', color: '#1E3A5F', marginTop: 2 },
  metricUnit:   { fontSize: 11, color: '#95A5A6' },
  chartHeader:  { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 4, marginBottom: 6 },
  chartTitle:   { fontSize: 11, fontWeight: '600', color: '#7F8C8D', textTransform: 'uppercase', letterSpacing: 1 },
  unitToggle:   { flexDirection: 'row', gap: 6 },
  unitBtn:      { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8, backgroundColor: '#F0F2F5', borderWidth: 1, borderColor: '#E0E4EA' },
  unitBtnActive:{ backgroundColor: '#1E3A5F', borderColor: '#1E3A5F' },
  unitBtnText:  { fontSize: 12, fontWeight: '600', color: '#7F8C8D' },
  unitBtnTextActive: { color: '#FFF' },
  ttxValue:     { fontSize: 42, fontWeight: '700', color: '#1E3A5F' },
  ttxLabel:     { fontSize: 14, color: '#7F8C8D', marginBottom: 4 },
  ttxMax:       { fontSize: 11, color: '#B0B8C4', marginBottom: 12 },
  ttxButtons:   { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 8, marginTop: 4 },
  ttxBtn:       { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 8, backgroundColor: '#F0F2F5', borderWidth: 1, borderColor: '#E0E4EA' },
  ttxBtnActive: { backgroundColor: '#1E3A5F', borderColor: '#1E3A5F' },
  ttxBtnText:   { fontSize: 14, fontWeight: '600', color: '#7F8C8D' },
  ttxBtnTextActive: { color: '#FFF' },
  noDetectText:    { fontSize: 13, color: '#95A5A6', fontStyle: 'italic', marginTop: 2 },
  unreliableWarn:  { fontSize: 13, color: '#E67E22', fontStyle: 'italic', lineHeight: 20, paddingVertical: 4 },
  syncLine:     { fontSize: 11, color: '#95A5A6', textAlign: 'center', marginTop: 10 },
  saveStatus:   { fontSize: 12, textAlign: 'center', marginTop: 12, marginBottom: 4 },
  saveOk:       { color: '#27AE60' },
  saveWarn:     { color: '#E67E22' },
});
