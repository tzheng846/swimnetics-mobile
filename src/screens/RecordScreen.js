/**
 * RecordScreen — BLE recording with full debug logging
 *
 * Debug log panel shows step-by-step status so we can pinpoint
 * exactly where the BLE pipeline fails.
 */

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

// ── Self-test: run on mount to verify parser and imports are working ───────────
function runSelfTests() {
  const results = [];

  // Test 1: parser with valid 14-byte packet
  const buf = Buffer.alloc(14);
  buf.writeUInt32LE(1000000, 0); buf.writeUInt16LE(2048, 4); buf.writeUInt8(1, 6);
  buf.writeUInt32LE(1000037, 7); buf.writeUInt16LE(2049, 11); buf.writeUInt8(1, 13);
  const { samples, error } = parsePacket(buf.toString('base64'));
  if (error || samples.length !== 2 || samples[0].timestamp_us !== 1000000) {
    results.push(`FAIL parsePacket(valid): ${error || 'wrong output'}`);
  } else {
    results.push('PASS parsePacket(valid 14-byte) → 2 samples');
  }

  // Test 2: parser rejects wrong length
  const { error: err2 } = parsePacket(Buffer.alloc(7).toString('base64'));
  if (!err2) results.push('FAIL parsePacket(7-byte): should have returned error');
  else results.push('PASS parsePacket(7-byte) → rejects with error');

  // Test 3: FileSystem legacy import
  try {
    if (typeof FileSystem.writeAsStringAsync !== 'function') throw new Error('not a function');
    results.push('PASS FileSystem.writeAsStringAsync is available');
  } catch (e) {
    results.push(`FAIL FileSystem: ${e.message}`);
  }

  // Test 4: Buffer base64 round-trip
  const original = 'Hello SwimLogger';
  const encoded = Buffer.from(original).toString('base64');
  const decoded = Buffer.from(encoded, 'base64').toString();
  if (decoded !== original) results.push('FAIL Buffer round-trip');
  else results.push('PASS Buffer base64 round-trip');

  return results;
}

// ── Velocity chart ────────────────────────────────────────────────────────────
function VelocityChart({ time, velocity }) {
  const W = Dimensions.get('window').width - 48;
  const H = 150;
  const PAD = 4;

  if (!time || time.length < 2) {
    return <Text style={{ color: '#999', marginTop: 8 }}>No data</Text>;
  }

  // Downsample to max 400 points for performance
  const step = Math.max(1, Math.floor(time.length / 400));
  const t = time.filter((_, i) => i % step === 0);
  const v = velocity.filter((_, i) => i % step === 0);

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
export default function RecordScreen() {
  const [bleState, setBleState] = useState('idle');
  const [devices, setDevices]   = useState([]);
  const [sampleCount, setSampleCount] = useState(0);
  const [savedPath, setSavedPath]     = useState(null);
  const [savedCount, setSavedCount]   = useState(0);
  const [debugLog, setDebugLog]       = useState([]);
  const [apiResult, setApiResult]     = useState(null);

  const deviceRef      = useRef(null);
  const subscriptionRef = useRef(null);
  const disconnectRef   = useRef(null);
  const samplesRef      = useRef([]);
  const scanTimerRef    = useRef(null);
  const firstPacketRef  = useRef(false);
  const isStoppingRef   = useRef(false); // guard against double-stop

  const log = useCallback((msg, level = 'info') => {
    const ts = new Date().toLocaleTimeString();
    setDebugLog(prev => [...prev, { ts, msg, level }]);
    console.log(`[${level.toUpperCase()}] ${msg}`);
  }, []);

  // Run self-tests on mount
  useEffect(() => {
    const results = runSelfTests();
    results.forEach(r => log(r, r.startsWith('FAIL') ? 'error' : 'ok'));
  }, [log]);

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
      const { path, count } = await saveCSV(captured);
      setSavedPath(path);
      setSavedCount(count);
      if (isError) {
        setBleState('error');
      } else {
        uploadAndProcess(path); // fire-and-forget — manages its own state transitions
      }
    } catch (e) {
      log(`Save failed: ${e.message}`, 'error');
      setBleState('error');
    }
  }, [log, saveCSV]); // uploadAndProcess omitted: it only depends on log (stable [] deps), never recreated

  // ── Upload to FastAPI ─────────────────────────────────────────────────────────
  // Uses FileSystem.uploadAsync (native multipart) instead of fetch + FormData
  // because RN 0.85/Hermes rejects the {uri, name, type} FormData pattern with
  // "Unsupported FormData implementation".
  const uploadAndProcess = useCallback(async (filePath) => {
    log(`Uploading to ${API_BASE}/process...`);
    setBleState('uploading');
    try {
      const result = await FileSystem.uploadAsync(`${API_BASE}/process`, filePath, {
        httpMethod: 'POST',
        uploadType: FileSystem.FileSystemUploadType.MULTIPART,
        fieldName: 'file',
        mimeType: 'text/csv',
        headers: {},
      });

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
  }, [log]);

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
            log(`Notification error: ${error.message} (code: ${error.errorCode})`, 'error');
            stopRecording(true);
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

      // Watch for unexpected disconnect
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
  const reset = useCallback(() => {
    // Clean up any live BLE subscriptions before wiping refs
    subscriptionRef.current?.remove();
    subscriptionRef.current = null;
    disconnectRef.current?.remove();
    disconnectRef.current = null;
    deviceRef.current = null;
    samplesRef.current = [];
    isStoppingRef.current = false;
    firstPacketRef.current = false;
    setDevices([]);
    setSampleCount(0);
    setSavedPath(null);
    setSavedCount(0);
    setApiResult(null);
    setBleState('idle');
    log('--- Reset ---');
  }, [log]);

  // ── Debug log color ───────────────────────────────────────────────────────────
  const logColor = (level) => {
    if (level === 'error') return '#C0392B';
    if (level === 'warn')  return '#E67E22';
    if (level === 'ok')    return '#27AE60';
    return '#555';
  };

  // ── Render ────────────────────────────────────────────────────────────────────
  return (
    <SafeAreaView style={styles.container}>
      <Text style={styles.title}>Swimnetics</Text>

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
              ⚠ Error — see log below
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
        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: 24, paddingBottom: 16 }}>
          <View style={styles.metricsGrid}>
            {[
              ['Stroke Rate', apiResult.session?.stroke_rate_spm?.toFixed(1) ?? '--', 'SPM'],
              ['Avg Speed',   apiResult.session?.mean_vel_ms?.toFixed(2)      ?? '--', 'm/s'],
              ['Distance',    apiResult.session?.total_dist_m?.toFixed(1)     ?? '--', 'm'],
              ['Fatigue',     apiResult.session?.fatigue_index_pct?.toFixed(1) ?? '--', '%'],
            ].map(([label, value, unit]) => (
              <View key={label} style={styles.metricCard}>
                <Text style={styles.metricLabel}>{label}</Text>
                <Text style={styles.metricValue}>{value}</Text>
                <Text style={styles.metricUnit}>{unit}</Text>
              </View>
            ))}
          </View>
          <Text style={styles.chartTitle}>Velocity</Text>
          <VelocityChart time={apiResult.time} velocity={apiResult.velocity} />
          <TouchableOpacity style={[styles.primaryBtn, { marginTop: 20, marginBottom: 8 }]} onPress={reset}>
            <Text style={styles.btnText}>Record Again</Text>
          </TouchableOpacity>
        </ScrollView>
      )}

      {/* DEBUG LOG */}
      <View style={styles.logContainer}>
        <Text style={styles.logHeader}>Debug Log</Text>
        <ScrollView style={styles.logScroll} ref={r => r?.scrollToEnd({ animated: true })}>
          {debugLog.map((entry, i) => (
            <Text key={i} style={[styles.logLine, { color: logColor(entry.level) }]}>
              {entry.ts} {entry.msg}
            </Text>
          ))}
        </ScrollView>
      </View>
    </SafeAreaView>
  );
}

// ── Styles ─────────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  container:    { flex: 1, backgroundColor: '#F5F7FA' },
  title:        { fontSize: 24, fontWeight: '700', color: '#1E3A5F', textAlign: 'center', marginTop: 16, marginBottom: 8 },
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
  metricsGrid:  { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', marginTop: 8 },
  metricCard:   { width: '48%', backgroundColor: '#FFF', borderRadius: 10, padding: 12, marginBottom: 8, alignItems: 'center' },
  metricLabel:  { fontSize: 11, color: '#7F8C8D', textTransform: 'uppercase', letterSpacing: 0.5 },
  metricValue:  { fontSize: 28, fontWeight: '700', color: '#1E3A5F', marginTop: 2 },
  metricUnit:   { fontSize: 12, color: '#95A5A6' },
  chartTitle:   { fontSize: 13, fontWeight: '600', color: '#7F8C8D', marginTop: 8, textTransform: 'uppercase' },
  logContainer: { flex: 1, marginHorizontal: 12, marginBottom: 8, backgroundColor: '#1A1A2E', borderRadius: 10, padding: 8 },
  logHeader:    { color: '#7F8C8D', fontSize: 11, fontWeight: '600', marginBottom: 4, textTransform: 'uppercase' },
  logScroll:    { flex: 1 },
  logLine:      { fontSize: 11, fontFamily: 'monospace', lineHeight: 18 },
});
