import React, { useRef, useState, useEffect, useCallback } from 'react';
import {
  View, Text, TouchableOpacity, FlatList,
  ActivityIndicator, SafeAreaView, StyleSheet, Alert,
} from 'react-native';
import { BleManager } from 'react-native-ble-plx';
import * as FileSystem from 'expo-file-system';
import { Buffer } from 'buffer';

// ── BLE constants ─────────────────────────────────────────────────────────────
const NUS_SERVICE = '6E400001-B5A3-F393-E0A9-E50E24DCCA9E';
const NUS_TX_CHAR = '6E400003-B5A3-F393-E0A9-E50E24DCCA9E'; // device → phone (notify)
const NUS_RX_CHAR = '6E400002-B5A3-F393-E0A9-E50E24DCCA9E'; // phone → device (write)
const DEVICE_NAME = 'SwimLogger';
const SCAN_TIMEOUT_MS = 8000;

// Single BleManager instance — do NOT create inside component
const manager = new BleManager();

// ── Packet parser ─────────────────────────────────────────────────────────────
// Packet: 14 bytes = 2 samples × 7 bytes
// Sample layout (little-endian): [uint32 timestamp_us][uint16 angle_counts][uint8 magnet_ok]
function parsePacket(base64) {
  const buf = Buffer.from(base64, 'base64');
  if (buf.length !== 14) return [];
  return [0, 7].map(offset => ({
    timestamp_us: buf.readUInt32LE(offset),
    angle_counts: buf.readUInt16LE(offset + 4),
    magnet_ok: buf.readUInt8(offset + 6),
  }));
}

// ── Component ─────────────────────────────────────────────────────────────────
export default function RecordScreen() {
  const [bleState, setBleState] = useState('idle');
  const [devices, setDevices] = useState([]);
  const [sampleCount, setSampleCount] = useState(0);
  const [savedPath, setSavedPath] = useState(null);
  const [savedCount, setSavedCount] = useState(0);
  const [errorMsg, setErrorMsg] = useState(null);

  // Refs: hold mutable values without triggering re-renders
  const deviceRef = useRef(null);
  const subscriptionRef = useRef(null);
  const disconnectSubRef = useRef(null);
  const samplesRef = useRef([]);
  const scanTimerRef = useRef(null);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      clearTimeout(scanTimerRef.current);
      manager.stopDeviceScan();
      subscriptionRef.current?.remove();
      disconnectSubRef.current?.remove();
    };
  }, []);

  // ── Save CSV ───────────────────────────────────────────────────────────────
  const saveCSV = useCallback(async (samples, isPartial = false) => {
    try {
      const header = 'timestamp_us,angle_counts,magnet_ok\n';
      const rows = samples.map(s => `${s.timestamp_us},${s.angle_counts},${s.magnet_ok}`).join('\n');
      const filename = `session_${Date.now()}.csv`;
      const path = FileSystem.documentDirectory + filename;
      await FileSystem.writeAsStringAsync(path, header + rows, {
        encoding: FileSystem.EncodingType.UTF8,
      });
      return { path, count: samples.length };
    } catch (e) {
      throw new Error(`Failed to save CSV: ${e.message}`);
    }
  }, []);

  // ── Stop recording ─────────────────────────────────────────────────────────
  const stopRecording = useCallback(async (isError = false) => {
    subscriptionRef.current?.remove();
    subscriptionRef.current = null;
    disconnectSubRef.current?.remove();
    disconnectSubRef.current = null;

    // Send STOP command with timeout so it cannot hang
    try {
      if (deviceRef.current) {
        await Promise.race([
          deviceRef.current.writeCharacteristicWithoutResponseForService(
            NUS_SERVICE, NUS_RX_CHAR,
            Buffer.from('STOP\n').toString('base64'),
          ),
          new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 1500)),
        ]);
      }
    } catch (_) { /* best-effort — continue regardless */ }

    setBleState('saving');

    const captured = [...samplesRef.current];
    try {
      const { path, count } = await saveCSV(captured, isError);
      setSavedPath(path);
      setSavedCount(count);
      setBleState(isError ? 'error' : 'done');
      if (isError) setErrorMsg('Connection lost. Partial data saved.');
    } catch (e) {
      setErrorMsg(e.message);
      setBleState('error');
    }
  }, [saveCSV]);

  // ── Scan ───────────────────────────────────────────────────────────────────
  const startScan = useCallback(() => {
    setDevices([]);
    setErrorMsg(null);
    setBleState('scanning');

    const seen = new Set();
    manager.startDeviceScan(null, { allowDuplicates: false }, (error, device) => {
      if (error) {
        setBleState('error');
        setErrorMsg(`Scan error: ${error.message}`);
        return;
      }
      if (device?.name === DEVICE_NAME && !seen.has(device.id)) {
        seen.add(device.id);
        setDevices(prev => [...prev, { id: device.id, name: device.name }]);
      }
    });

    scanTimerRef.current = setTimeout(() => {
      manager.stopDeviceScan();
      setBleState('idle');
    }, SCAN_TIMEOUT_MS);
  }, []);

  // ── Connect ────────────────────────────────────────────────────────────────
  const connectTo = useCallback(async (deviceId) => {
    clearTimeout(scanTimerRef.current);
    manager.stopDeviceScan();
    setErrorMsg(null);
    setBleState('connecting');

    try {
      const device = await manager.connectToDevice(deviceId);
      await device.discoverAllServicesAndCharacteristics();
      deviceRef.current = device;
      setBleState('connected');
    } catch (e) {
      setBleState('error');
      setErrorMsg(`Connection failed: ${e.message}`);
    }
  }, []);

  // ── Start recording ────────────────────────────────────────────────────────
  const startRecording = useCallback(async () => {
    samplesRef.current = [];
    setSampleCount(0);
    setSavedPath(null);
    setErrorMsg(null);

    try {
      // Subscribe to notifications FIRST — device may start streaming immediately
      subscriptionRef.current = deviceRef.current.monitorCharacteristicForService(
        NUS_SERVICE, NUS_TX_CHAR,
        (error, characteristic) => {
          if (error) {
            // Surface the actual error for debugging
            Alert.alert('BLE Error', error.message || String(error));
            stopRecording(true);
            return;
          }
          const samples = parsePacket(characteristic.value);
          samplesRef.current.push(...samples);
          setSampleCount(c => c + samples.length);
        },
      );

      // Send START command (best-effort — some firmware needs it, some don't)
      try {
        await Promise.race([
          deviceRef.current.writeCharacteristicWithoutResponseForService(
            NUS_SERVICE, NUS_RX_CHAR,
            Buffer.from('START\n').toString('base64'),
          ),
          new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 1500)),
        ]);
      } catch (_) { /* ignore — device streams without START on some firmware */ }

      // Handle unexpected disconnect
      disconnectSubRef.current = deviceRef.current.onDisconnected(() => {
        stopRecording(true);
      });

      setBleState('recording');
    } catch (e) {
      Alert.alert('Start failed', e.message || String(e));
      setBleState('error');
      setErrorMsg(`Failed to start: ${e.message}`);
    }
  }, [stopRecording]);

  // ── Reset ──────────────────────────────────────────────────────────────────
  const reset = useCallback(() => {
    deviceRef.current = null;
    samplesRef.current = [];
    setDevices([]);
    setSampleCount(0);
    setSavedPath(null);
    setSavedCount(0);
    setErrorMsg(null);
    setBleState('idle');
  }, []);

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <SafeAreaView style={styles.container}>
      <Text style={styles.title}>Swimnetics</Text>

      {/* IDLE / DEVICE LIST */}
      {(bleState === 'idle') && (
        <View style={styles.section}>
          <TouchableOpacity style={styles.primaryBtn} onPress={startScan}>
            <Text style={styles.btnText}>Scan for Devices</Text>
          </TouchableOpacity>
          {devices.length > 0 && (
            <>
              <Text style={styles.label}>Found devices:</Text>
              <FlatList
                data={devices}
                keyExtractor={item => item.id}
                renderItem={({ item }) => (
                  <TouchableOpacity
                    style={styles.deviceItem}
                    onPress={() => connectTo(item.id)}
                  >
                    <Text style={styles.deviceName}>{item.name}</Text>
                    <Text style={styles.deviceId}>{item.id}</Text>
                  </TouchableOpacity>
                )}
              />
            </>
          )}
        </View>
      )}

      {/* SCANNING */}
      {bleState === 'scanning' && (
        <View style={styles.section}>
          <ActivityIndicator size="large" color="#1E3A5F" />
          <Text style={styles.statusText}>Scanning for SwimLogger...</Text>
        </View>
      )}

      {/* CONNECTING */}
      {bleState === 'connecting' && (
        <View style={styles.section}>
          <ActivityIndicator size="large" color="#1E3A5F" />
          <Text style={styles.statusText}>Connecting...</Text>
        </View>
      )}

      {/* CONNECTED */}
      {bleState === 'connected' && (
        <View style={styles.section}>
          <Text style={styles.statusText}>✓ SwimLogger connected</Text>
          <TouchableOpacity style={styles.primaryBtn} onPress={startRecording}>
            <Text style={styles.btnText}>Start Recording</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* RECORDING */}
      {bleState === 'recording' && (
        <View style={styles.section}>
          <Text style={styles.counterLabel}>Samples</Text>
          <Text style={styles.counter}>{sampleCount.toLocaleString()}</Text>
          <TouchableOpacity style={styles.stopBtn} onPress={() => stopRecording(false)}>
            <Text style={styles.btnText}>Stop Recording</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* SAVING */}
      {bleState === 'saving' && (
        <View style={styles.section}>
          <ActivityIndicator size="large" color="#1E3A5F" />
          <Text style={styles.statusText}>Saving...</Text>
        </View>
      )}

      {/* DONE */}
      {bleState === 'done' && (
        <View style={styles.section}>
          <Text style={styles.successText}>✓ Saved {savedCount.toLocaleString()} samples</Text>
          <Text style={styles.pathText}>{savedPath?.split('/').pop()}</Text>
          <TouchableOpacity style={styles.primaryBtn} onPress={reset}>
            <Text style={styles.btnText}>Record Again</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* ERROR */}
      {bleState === 'error' && (
        <View style={styles.section}>
          <Text style={styles.errorText}>⚠ {errorMsg || 'An error occurred'}</Text>
          {savedPath && (
            <Text style={styles.pathText}>
              Partial save: {savedPath.split('/').pop()} ({savedCount.toLocaleString()} samples)
            </Text>
          )}
          <TouchableOpacity style={styles.primaryBtn} onPress={reset}>
            <Text style={styles.btnText}>Try Again</Text>
          </TouchableOpacity>
        </View>
      )}
    </SafeAreaView>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F5F7FA',
  },
  title: {
    fontSize: 28,
    fontWeight: '700',
    color: '#1E3A5F',
    textAlign: 'center',
    marginTop: 24,
    marginBottom: 32,
  },
  section: {
    flex: 1,
    alignItems: 'center',
    paddingHorizontal: 24,
  },
  primaryBtn: {
    backgroundColor: '#1E3A5F',
    borderRadius: 12,
    paddingVertical: 16,
    paddingHorizontal: 40,
    marginTop: 16,
  },
  stopBtn: {
    backgroundColor: '#C0392B',
    borderRadius: 12,
    paddingVertical: 16,
    paddingHorizontal: 40,
    marginTop: 32,
  },
  btnText: {
    color: '#FFFFFF',
    fontSize: 17,
    fontWeight: '600',
  },
  statusText: {
    fontSize: 17,
    color: '#2C3E50',
    marginTop: 16,
    textAlign: 'center',
  },
  label: {
    fontSize: 15,
    color: '#7F8C8D',
    marginTop: 24,
    marginBottom: 8,
    alignSelf: 'flex-start',
  },
  deviceItem: {
    width: '100%',
    backgroundColor: '#FFFFFF',
    borderRadius: 10,
    padding: 14,
    marginBottom: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08,
    shadowRadius: 3,
    elevation: 2,
  },
  deviceName: {
    fontSize: 16,
    fontWeight: '600',
    color: '#1E3A5F',
  },
  deviceId: {
    fontSize: 12,
    color: '#95A5A6',
    marginTop: 2,
  },
  counterLabel: {
    fontSize: 16,
    color: '#7F8C8D',
    marginTop: 40,
  },
  counter: {
    fontSize: 64,
    fontWeight: '700',
    color: '#1E3A5F',
    marginTop: 8,
  },
  successText: {
    fontSize: 20,
    fontWeight: '600',
    color: '#27AE60',
    marginTop: 32,
    textAlign: 'center',
  },
  pathText: {
    fontSize: 13,
    color: '#95A5A6',
    marginTop: 8,
    textAlign: 'center',
  },
  errorText: {
    fontSize: 16,
    color: '#C0392B',
    marginTop: 32,
    textAlign: 'center',
    paddingHorizontal: 16,
  },
});
