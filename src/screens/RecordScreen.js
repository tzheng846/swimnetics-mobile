import React, { useRef, useState, useEffect, useCallback } from 'react';
import {
  View, Text, TouchableOpacity, FlatList,
  ActivityIndicator, SafeAreaView, StyleSheet,
  ScrollView, Dimensions,
} from 'react-native';
import { BleManager } from 'react-native-ble-plx';
import * as FileSystem from 'expo-file-system/legacy';
import { Buffer } from 'buffer';
import Svg, { Polyline, Line, Text as SvgText } from 'react-native-svg';
import { API_BASE } from '../config';
import { useAuth } from '../context/AuthContext';

// ── BLE constants ─────────────────────────────────────────────────────────────
const NUS_SERVICE = '6E400001-B5A3-F393-E0A9-E50E24DCCA9E';
const NUS_TX_CHAR = '6E400003-B5A3-F393-E0A9-E50E24DCCA9E'; // device → phone (notify)
const NUS_RX_CHAR = '6E400002-B5A3-F393-E0A9-E50E24DCCA9E'; // phone → device (write)
const DEVICE_NAME = 'SwimLogger';

// UUID comparison is case-insensitive — BLE stacks return varying cases
const uuidEq = (a, b) => a?.toLowerCase() === b?.toLowerCase();

// ── BleManager: one instance for app lifetime ─────────────────────────────────
const manager = new BleManager();

// ── Packet parser ─────────────────────────────────────────────────────────────
// Expected: 14 bytes = 2 samples × 7 bytes
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
  if (buf.length !== 14) {
    return { samples: [], error: `unexpected length ${buf.length} (expected 14)` };
  }
  const samples = [0, 7].map(offset => ({
    timestamp_us: buf.readUInt32LE(offset),
    angle_counts: buf.readUInt16LE(offset + 4),
    magnet_ok: buf.readUInt8(offset + 6),
  }));
  return { samples, error: null };
}

// ── Velocity chart ────────────────────────────────────────────────────────────
function VelocityChart({ time, velocity }) {
  const W = Dimensions.get('window').width - 48;
  const H = 150;
  const PAD = 4;

  if (!time || time.length < 2) {
    return <Text style={{ color: '#999', marginTop: 8 }}>No data</Text>;
  }

  // Downsample to max 400 points; filter null/NaN (from _clean() in api.py)
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

// ── Component ─────────────────────────────────────────────────────────────────
export default function RecordScreen({ route, navigation }) {
  const { athleteId, athleteName, strokeType = 'breaststroke', headWaistM = 0 } = route?.params ?? {};
  const { session, signOut } = useAuth();
  const sessionRef = useRef(session);
  useEffect(() => { sessionRef.current = session; }, [session]);

  const [bleState, setBleState] = useState('idle');
  const [devices, setDevices]   = useState([]);
  const [sampleCount, setSampleCount] = useState(0);
  const [savedPath, setSavedPath]     = useState(null);
  const [apiResult, setApiResult]     = useState(null);
  const deviceRef      = useRef(null);
  const subscriptionRef = useRef(null);
  const disconnectRef   = useRef(null);
  const samplesRef      = useRef([]);
  const scanTimerRef    = useRef(null);
  const firstPacketRef  = useRef(false);
  const isStoppingRef   = useRef(false);

  const log = useCallback((msg, level = 'info') => {
    console.log(`[${level.toUpperCase()}] ${msg}`);
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      clearTimeout(scanTimerRef.current);
      manager.stopDeviceScan();
      subscriptionRef.current?.remove();
      disconnectRef.current?.remove();
    };
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

  // ── Stop recording ────────────────────────────────────────────────────────────
  const stopRecording = useCallback(async (isError = false) => {
    if (isStoppingRef.current) { log('stopRecording called twice — ignoring', 'warn'); return; }
    isStoppingRef.current = true;
    log('Stopping recording...');
    subscriptionRef.current?.remove();
    subscriptionRef.current = null;
    disconnectRef.current?.remove();
    disconnectRef.current = null;

    try {
      if (deviceRef.current) {
        log('Sending STOP command (write-with-response)...');
        await Promise.race([
          deviceRef.current.writeCharacteristicWithResponseForService(
            NUS_SERVICE, NUS_RX_CHAR,
            Buffer.from('STOP\n').toString('base64'),
          ),
          new Promise((_, reject) => setTimeout(() => reject(new Error('write timeout')), 1500)),
        ]);
        log('STOP command sent', 'ok');
      }
    } catch (e) {
      log(`STOP command failed (non-fatal): ${e.message}`, 'warn');
    }

    setBleState('saving');
    const captured = [...samplesRef.current];
    log(`Captured ${captured.length} total samples`);

    try {
      const { path } = await saveCSV(captured);
      setSavedPath(path);
      if (isError) {
        setBleState('error');
      } else {
        uploadAndProcess(path); // fire-and-forget — manages its own state transitions
      }
    } catch (e) {
      log(`Save failed: ${e.message}`, 'error');
      setBleState('error');
    }
  }, [log, saveCSV]);

  // ── Upload to FastAPI ─────────────────────────────────────────────────────────
  // Uses FileSystem.uploadAsync (native multipart) instead of fetch + FormData
  // because RN 0.85/Hermes rejects the {uri, name, type} FormData pattern with
  // "Unsupported FormData implementation".
  const uploadAndProcess = useCallback(async (filePath) => {
    setBleState('uploading');
    log(`Uploading — athlete_id: ${athleteId ?? 'none'}, head_waist_m: ${headWaistM}`);
    try {
      const authHeaders = sessionRef.current?.access_token
        ? { Authorization: `Bearer ${sessionRef.current.access_token}` }
        : {};
      const parameters = { head_waist_m: String(headWaistM) };
      if (athleteId) parameters.athlete_id = String(athleteId);

      const result = await FileSystem.uploadAsync(`${API_BASE}/process`, filePath, {
        httpMethod: 'POST',
        uploadType: FileSystem.FileSystemUploadType.MULTIPART,
        fieldName: 'file',
        mimeType: 'text/csv',
        headers: authHeaders,
        parameters,
      });

      if (result.status < 200 || result.status >= 300) {
        throw new Error(`API ${result.status}: ${result.body.slice(0, 120)}`);
      }

      const data = JSON.parse(result.body);
      log(`Upload complete. Stroke rate: ${data.session?.stroke_rate_spm?.toFixed(1)} SPM`, 'ok');
      setApiResult(data);
      setBleState('results');

      // Re-register disconnect watcher for results state.
      // stopRecording() clears disconnectRef, so without this the device can
      // disconnect silently (firmware idle timeout after STOP) and the UI
      // stays stale until the user taps "Record Again".
      if (deviceRef.current) {
        disconnectRef.current?.remove();
        disconnectRef.current = deviceRef.current.onDisconnected(() => {
          disconnectRef.current = null;
          deviceRef.current = null;
          setDevices([]);
          log('Device disconnected — session saved. Tap "Record Again" to rescan.', 'warn');
          setBleState('idle');
        });
      }

    } catch (e) {
      log(`Upload failed: ${e.message}`, 'error');
      setBleState('error');
    }
  }, [log, athleteId, headWaistM]);

  // ── Scan ──────────────────────────────────────────────────────────────────────
  const startScan = useCallback(() => {
    setDevices([]);
    setBleState('scanning');
    log('Starting BLE scan for "SwimLogger"...');

    const seen = new Set();
    manager.startDeviceScan(null, { allowDuplicates: false }, (error, device) => {
      if (error) {
        log(`Scan error: ${error.message}`, 'error');
        setBleState('idle');
        return;
      }
      if (device?.name) {
        log(`Found: "${device.name}" (${device.id})`);
        if (device.name === DEVICE_NAME && !seen.has(device.id)) {
          seen.add(device.id);
          setDevices(prev => [...prev, { id: device.id, name: device.name }]);
          log(`SwimLogger found!`, 'ok');
        }
      }
    });

    scanTimerRef.current = setTimeout(() => {
      manager.stopDeviceScan();
      log('Scan complete');
      setBleState('idle');
    }, 8000);
  }, [log]);

  // ── Connect & discover ────────────────────────────────────────────────────────
  const connectTo = useCallback(async (deviceId) => {
    clearTimeout(scanTimerRef.current);
    manager.stopDeviceScan();
    setBleState('connecting');
    log(`Connecting to ${deviceId}...`);

    try {
      const device = await manager.connectToDevice(deviceId);
      log('Connected. Discovering services...', 'ok');

      await device.discoverAllServicesAndCharacteristics();
      log('Discovery complete', 'ok');

      // Enumerate all services and characteristics for debugging
      const services = await device.services();
      log(`Found ${services.length} service(s):`);
      let nusFound = false;
      let txFound = false;
      let rxFound = false;

      for (const svc of services) {
        const isNUS = uuidEq(svc.uuid, NUS_SERVICE);
        log(`  Service: ${svc.uuid}${isNUS ? ' ← NUS ✓' : ''}`);
        if (isNUS) nusFound = true;

        const chars = await svc.characteristics();
        for (const c of chars) {
          const isTX = uuidEq(c.uuid, NUS_TX_CHAR);
          const isRX = uuidEq(c.uuid, NUS_RX_CHAR);
          const props = [
            c.isNotifiable    ? 'notify'  : '',
            c.isIndicatable   ? 'indicate': '',
            c.isWritableWithoutResponse ? 'write-no-resp' : '',
            c.isWritableWithResponse    ? 'write-resp'    : '',
            c.isReadable      ? 'read'    : '',
          ].filter(Boolean).join(', ');
          log(`    Char: ${c.uuid} [${props}]${isTX ? ' ← TX ✓' : ''}${isRX ? ' ← RX ✓' : ''}`);
          if (isTX) txFound = true;
          if (isRX) rxFound = true;
        }
      }

      if (!nusFound) log('WARNING: NUS service NOT found in device services!', 'error');
      if (!txFound)  log('WARNING: NUS TX characteristic NOT found!', 'error');
      if (!rxFound)  log('WARNING: NUS RX characteristic NOT found!', 'warn');

      deviceRef.current = device;

      // Watch for unexpected disconnects while in connected/results state
      disconnectRef.current = device.onDisconnected(() => {
        log('SwimLogger disconnected unexpectedly', 'warn');
        disconnectRef.current = null;
        deviceRef.current = null;
        setDevices([]);
        setBleState('idle'); // go to idle so user can rescan
      });

      setBleState('connected');
    } catch (e) {
      log(`Connection failed: ${e.message}`, 'error');
      setBleState('idle');
    }
  }, [log]);

  // ── Start recording ───────────────────────────────────────────────────────────
  const startRecording = useCallback(async () => {
    samplesRef.current = [];
    firstPacketRef.current = false;
    isStoppingRef.current = false; // safety reset — ensures Stop works on every session
    setSampleCount(0);
    setSavedPath(null);
    setBleState('recording');
    log('Starting recording...');

    try {
      // Subscribe FIRST — before sending START
      log(`Subscribing to TX char: ${NUS_TX_CHAR}`);
      subscriptionRef.current = deviceRef.current.monitorCharacteristicForService(
        NUS_SERVICE, NUS_TX_CHAR,
        (error, characteristic) => {
          if (error) {
            // Code 2 = OperationCancelled — expected when Stop removes the subscription
            if (error.errorCode === 2) {
              log(`Subscription cancelled (expected on stop)`, 'warn');
              return;
            }
            // Log other errors but do NOT auto-stop — avoids spurious double-stop.
            // The disconnect watcher handles true device disconnections.
            log(`Notification error: ${error.message} (code: ${error.errorCode})`, 'error');
            return;
          }

          if (!firstPacketRef.current) {
            firstPacketRef.current = true;
            log(`First packet received! value length hint: ${
              characteristic.value ? Buffer.from(characteristic.value, 'base64').length : 'null'
            } bytes`, 'ok');
          }

          const { samples, error: parseError } = parsePacket(characteristic.value);
          if (parseError) {
            log(`Parse error: ${parseError}`, 'error');
            return;
          }
          samplesRef.current.push(...samples);
          setSampleCount(c => c + samples.length);
        },
      );
      log('Subscription active. Waiting for data...', 'ok');

      // Send START — RX char is [write-resp] so use writeWithResponse
      log(`Sending START to RX char: ${NUS_RX_CHAR} (write-with-response)`);
      try {
        await Promise.race([
          deviceRef.current.writeCharacteristicWithResponseForService(
            NUS_SERVICE, NUS_RX_CHAR,
            Buffer.from('START\n').toString('base64'),
          ),
          new Promise((_, reject) => setTimeout(() => reject(new Error('write timeout')), 3000)),
        ]);
        log('START sent and acknowledged by device', 'ok');
      } catch (e) {
        log(`START write failed: ${e.message} — continuing anyway`, 'warn');
      }

      // Replace idle watcher with recording watcher — remove old before registering new
      disconnectRef.current?.remove();
      disconnectRef.current = deviceRef.current.onDisconnected((error) => {
        log(`Device disconnected${error ? ': ' + error.message : ''}`, 'warn');
        stopRecording(true);
      });

    } catch (e) {
      log(`Failed to start: ${e.message}`, 'error');
      setBleState('connected');
    }
  }, [log, stopRecording]);

  // ── Reset ─────────────────────────────────────────────────────────────────────
  const reset = useCallback(async () => {
    // Clean up any active recording subscriptions (already null after stopRecording,
    // but guard in case reset is called from an unexpected state)
    subscriptionRef.current?.remove();
    subscriptionRef.current = null;
    disconnectRef.current?.remove();
    disconnectRef.current = null;

    // Check if the BLE connection is still alive — stay connected if so
    let stillConnected = false;
    if (deviceRef.current) {
      try {
        stillConnected = await deviceRef.current.isConnected();
      } catch (_) {}
    }

    samplesRef.current = [];
    isStoppingRef.current = false;
    firstPacketRef.current = false;
    setSampleCount(0);
    setSavedPath(null);
    setApiResult(null);

    if (stillConnected) {
      // Device still connected — go straight to connected state, skip scan
      log('--- Reset (device still connected) ---');
      setBleState('connected');
    } else {
      // Connection dropped — go to idle so user can rescan
      deviceRef.current = null;
      setDevices([]);
      log('--- Reset (device disconnected, scan to reconnect) ---');
      setBleState('idle');
    }
  }, [log]);

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
      {/* STATUS AREA — hidden during results to avoid wasting space */}
      {bleState !== 'results' && <View style={styles.statusArea}>
        {(bleState === 'idle') && (
          <>
            <TouchableOpacity style={styles.primaryBtn} onPress={startScan}>
              <Text style={styles.btnText}>Scan for Devices</Text>
            </TouchableOpacity>
            {devices.length > 0 && (
              <FlatList
                data={devices}
                keyExtractor={i => i.id}
                style={{ marginTop: 12, width: '100%' }}
                renderItem={({ item }) => (
                  <TouchableOpacity style={styles.deviceItem} onPress={() => connectTo(item.id)}>
                    <Text style={styles.deviceName}>{item.name}</Text>
                    <Text style={styles.deviceId}>{item.id}</Text>
                  </TouchableOpacity>
                )}
              />
            )}
          </>
        )}

        {bleState === 'scanning' && (
          <View style={styles.row}>
            <ActivityIndicator color="#1E3A5F" />
            <Text style={styles.statusText}> Scanning...</Text>
          </View>
        )}

        {bleState === 'connecting' && (
          <View style={styles.row}>
            <ActivityIndicator color="#1E3A5F" />
            <Text style={styles.statusText}> Connecting...</Text>
          </View>
        )}

        {bleState === 'connected' && (
          <>
            <Text style={[styles.statusText, { color: '#27AE60' }]}>✓ SwimLogger connected</Text>
            <TouchableOpacity style={styles.primaryBtn} onPress={startRecording}>
              <Text style={styles.btnText}>Start Recording</Text>
            </TouchableOpacity>
          </>
        )}

        {bleState === 'recording' && (
          <>
            <Text style={styles.counterLabel}>Samples</Text>
            <Text style={styles.counter}>{sampleCount.toLocaleString()}</Text>
            <TouchableOpacity style={styles.stopBtn} onPress={() => stopRecording(false)}>
              <Text style={styles.btnText}>Stop Recording</Text>
            </TouchableOpacity>
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
            <TouchableOpacity style={styles.primaryBtn} onPress={reset}>
              <Text style={styles.btnText}>Record Again</Text>
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
                <MetricItem label="Pulldown Peak" value={apiResult.initial_phase.pulldown_peak_vel_ms?.toFixed(2)} unit="m/s" />
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
              <MetricItem label="Distance"     value={apiResult.session?.total_dist_m?.toFixed(1)}         unit="m" />
              <MetricItem label="Stroke Rate"  value={apiResult.session?.stroke_rate_spm?.toFixed(1)}      unit="SPM" />
            </View>
            <View style={styles.metricRow}>
              <MetricItem label="Strokes"      value={apiResult.session?.stroke_count}                     unit="" />
              <MetricItem label="Avg Speed"    value={apiResult.session?.mean_vel_ms?.toFixed(2)}           unit="m/s" />
              <MetricItem label="Max Speed"    value={apiResult.session?.max_vel_ms?.toFixed(2)}            unit="m/s" />
            </View>
          </View>

          {/* ── Efficiency ── */}
          <View style={styles.sectionCard}>
            <Text style={styles.sectionTitle}>Efficiency</Text>
            <View style={styles.metricRow}>
              <MetricItem label="Dist/Stroke"  value={apiResult.session?.mean_dps_m?.toFixed(2)}                       unit="m" />
              <MetricItem label="Impulse"      value={apiResult.session?.mean_impulse_m?.toFixed(2)}                    unit="m" />
              <MetricItem label="Coast"        value={apiResult.session?.mean_coast_fraction != null ? (apiResult.session.mean_coast_fraction * 100).toFixed(1) : null} unit="%" />
            </View>
            <View style={styles.metricRow}>
              <MetricItem label="ISI CV"       value={apiResult.session?.cv_isi != null ? (apiResult.session.cv_isi * 100).toFixed(1) : null}             unit="%" />
              <MetricItem label="Arm Peak CV"  value={apiResult.session?.cv_arm_peak_vel != null ? (apiResult.session.cv_arm_peak_vel * 100).toFixed(1) : null} unit="%" />
              <MetricItem label="Fatigue"      value={apiResult.session?.fatigue_index_pct?.toFixed(1)}                unit="%" />
            </View>
          </View>

          {/* ── Velocity Chart ── */}
          <Text style={styles.chartTitle}>Velocity</Text>
          <VelocityChart time={apiResult.time} velocity={apiResult.velocity} />

          {/* ── Time to Distance ── */}
          <View style={styles.sectionCard}>
            <Text style={styles.sectionTitle}>Time to Distance</Text>
            <TimeToX
              timeArr={apiResult.time}
              distArr={apiResult.distance}
              baselineEndS={apiResult.session?.baseline_end_s}
              headWaistM={headWaistM}
            />
          </View>

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

  const defaultTarget = presets[Math.min(presets.length - 1, presets.findIndex(p => p >= 5) >= 0 ? presets.findIndex(p => p >= 5) : presets.length - 1)];
  const [targetM, setTargetM] = React.useState(defaultTarget);

  React.useEffect(() => {
    if (!presets.includes(targetM)) setTargetM(presets[presets.length - 1]);
  }, [presets]);

  const timeToX = React.useMemo(
    () => computeTimeToX(timeArr, distArr, baselineEndS, headWaistM, targetM),
    [timeArr, distArr, baselineEndS, headWaistM, targetM]
  );

  return (
    <View style={{ alignItems: 'center' }}>
      <Text style={styles.ttxValue}>{timeToX != null ? `${timeToX} s` : '--'}</Text>
      <Text style={styles.ttxLabel}>to {targetM} m</Text>
      {maxReachableM != null && (
        <Text style={styles.ttxMax}>Max from start: {maxReachableM.toFixed(1)} m</Text>
      )}
      <View style={styles.ttxButtons}>
        {presets.map(p => (
          <TouchableOpacity
            key={p}
            style={[styles.ttxBtn, targetM === p && styles.ttxBtnActive]}
            onPress={() => setTargetM(p)}
          >
            <Text style={[styles.ttxBtnText, targetM === p && styles.ttxBtnTextActive]}>{p}m</Text>
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
  stopBtn:      { backgroundColor: '#C0392B', borderRadius: 12, paddingVertical: 14, paddingHorizontal: 36, marginTop: 20 },
  btnText:      { color: '#FFF', fontSize: 16, fontWeight: '600' },
  statusText:   { fontSize: 15, color: '#2C3E50', marginTop: 12, textAlign: 'center' },
  deviceItem:   { backgroundColor: '#FFF', borderRadius: 10, padding: 12, marginBottom: 8, width: '100%' },
  deviceName:   { fontSize: 15, fontWeight: '600', color: '#1E3A5F' },
  deviceId:     { fontSize: 11, color: '#95A5A6', marginTop: 2 },
  counterLabel: { fontSize: 14, color: '#7F8C8D', marginTop: 20 },
  counter:      { fontSize: 56, fontWeight: '700', color: '#1E3A5F' },
  pathText:     { fontSize: 12, color: '#95A5A6', marginTop: 4, textAlign: 'center' },
  sectionCard:  { backgroundColor: '#FFF', borderRadius: 12, padding: 14, marginBottom: 10 },
  sectionTitle: { fontSize: 11, color: '#7F8C8D', fontWeight: '600', letterSpacing: 1, textTransform: 'uppercase', marginBottom: 10 },
  metricRow:    { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 8 },
  metricLabel:  { fontSize: 11, color: '#7F8C8D', textTransform: 'uppercase', letterSpacing: 0.5 },
  metricValue:  { fontSize: 22, fontWeight: '700', color: '#1E3A5F', marginTop: 2 },
  metricUnit:   { fontSize: 11, color: '#95A5A6' },
  chartTitle:   { fontSize: 11, fontWeight: '600', color: '#7F8C8D', marginTop: 4, marginBottom: 6, textTransform: 'uppercase', letterSpacing: 1 },
  ttxValue:     { fontSize: 42, fontWeight: '700', color: '#1E3A5F' },
  ttxLabel:     { fontSize: 14, color: '#7F8C8D', marginBottom: 4 },
  ttxMax:       { fontSize: 11, color: '#B0B8C4', marginBottom: 12 },
  ttxButtons:   { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 8, marginTop: 4 },
  ttxBtn:       { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 8, backgroundColor: '#F0F2F5', borderWidth: 1, borderColor: '#E0E4EA' },
  ttxBtnActive: { backgroundColor: '#1E3A5F', borderColor: '#1E3A5F' },
  ttxBtnText:   { fontSize: 14, fontWeight: '600', color: '#7F8C8D' },
  ttxBtnTextActive: { color: '#FFF' },
  noDetectText: { fontSize: 13, color: '#95A5A6', fontStyle: 'italic', marginTop: 2 },
  saveStatus:   { fontSize: 12, textAlign: 'center', marginTop: 12, marginBottom: 4 },
  saveOk:       { color: '#27AE60' },
  saveWarn:     { color: '#E67E22' },
});
