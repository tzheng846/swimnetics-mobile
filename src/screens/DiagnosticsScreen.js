import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View, Text, TouchableOpacity, SafeAreaView, StyleSheet, ScrollView,
} from 'react-native';
import { Buffer } from 'buffer';
import { useBle } from '../context/BleContext';
import { parseStatus, magnetVerdict } from '../lib/deviceStatus';
import { colors } from '../theme';

// ── BLE constants (mirror RecordScreen — no shared-plumbing refactor this plan) ──
const NUS_SERVICE = '6E400001-B5A3-F393-E0A9-E50E24DCCA9E';
const NUS_TX_CHAR = '6E400003-B5A3-F393-E0A9-E50E24DCCA9E'; // device → phone (notify)
const NUS_RX_CHAR = '6E400002-B5A3-F393-E0A9-E50E24DCCA9E'; // phone → device (write)

const POLL_INTERVAL_MS   = 500;  // ~2 Hz
const STALE_MS           = 3000; // older than this → link looks dead

// STATUS-packet decoding (parseStatus / magnetVerdict / constants) now lives in
// src/lib/deviceStatus.js — shared with the RecordScreen pre-record encoder check.

export default function DiagnosticsScreen({ navigation }) {
  const { connectedDevice, connectionStatus } = useBle();
  const deviceRef = useRef(connectedDevice);
  useEffect(() => { deviceRef.current = connectedDevice; }, [connectedDevice]);

  const [status, setStatus]         = useState(null);
  const [lastUpdate, setLastUpdate] = useState(null);
  const [now, setNow]               = useState(Date.now());

  // Tick once a second so the "updated Xs ago" freshness line stays live even
  // between STATUS packets.
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  // Subscribe to TX + poll STATUS while a device is connected.
  useEffect(() => {
    const device = connectedDevice;
    if (!device) return;

    const subscription = device.monitorCharacteristicForService(
      NUS_SERVICE, NUS_TX_CHAR,
      (error, characteristic) => {
        if (error || !characteristic?.value) return;
        const parsed = parseStatus(characteristic.value);
        if (parsed) { setStatus(parsed); setLastUpdate(Date.now()); }
        // Non-STATUS notifies (samples/META/end-marker) parse to null → ignored.
      },
    );

    const writeStatus = () => {
      deviceRef.current
        ?.writeCharacteristicWithResponseForService(
          NUS_SERVICE, NUS_RX_CHAR,
          Buffer.from('STATUS\n').toString('base64'),
        )
        .catch(() => { /* transient write failure — next tick retries */ });
    };

    writeStatus();
    const poll = setInterval(writeStatus, POLL_INTERVAL_MS);

    return () => {
      clearInterval(poll);
      subscription.remove();
    };
  }, [connectedDevice]);

  const ageS = lastUpdate ? Math.round((now - lastUpdate) / 1000) : null;
  const stale = lastUpdate ? (now - lastUpdate) > STALE_MS : false;

  const isConnected = connectedDevice && connectionStatus === 'connected';

  const renderBody = () => {
    if (!isConnected) {
      return (
        <Text style={st.empty}>
          No device connected.{'\n'}Pair and connect an encoder on the Devices screen, then come back.
        </Text>
      );
    }
    if (!status) {
      return <Text style={st.empty}>Reading device…</Text>;
    }

    const v = magnetVerdict(status.statusByte);

    return (
      <>
        {/* ── Magnet & wiring ── */}
        <Text style={st.sectionLabel}>MAGNET & WIRING</Text>
        <View style={st.card}>
          <View style={st.row}>
            <Text style={st.rowLabel}>Magnet</Text>
            <Text style={[st.rowValue, { color: v.color }]}>{v.title}</Text>
          </View>
          <Text style={st.detail}>{v.detail}</Text>

          <View style={st.divider} />
          <View style={st.row}>
            <Text style={st.rowLabel}>Raw angle</Text>
            <Text style={st.rowValue}>{status.angle}</Text>
          </View>
          <Text style={st.detail}>Spin the wheel — this number should change. If it stays fixed while spinning, the encoder or its wiring is the problem (not the magnet).</Text>

          <View style={st.divider} />
          <View style={st.row}>
            <Text style={st.rowLabel}>AGC (gain)</Text>
            <Text style={st.rowValue}>{status.agc}</Text>
          </View>
          <Text style={st.detail}>Auto-gain reflects the magnet gap. Very high or very low values mean the magnet is too far or too close.</Text>
        </View>

        {/* ── Recording & buffer ── */}
        <Text style={st.sectionLabel}>RECORDING & BUFFER</Text>
        <View style={st.card}>
          <View style={st.row}>
            <Text style={st.rowLabel}>Recording</Text>
            <Text style={[st.rowValue, { color: status.recording ? colors.good : colors.textMuted }]}>
              {status.recording ? 'ON' : 'off'}
            </Text>
          </View>
          <View style={st.row}>
            <Text style={st.rowLabel}>Buffered session</Text>
            <Text style={[st.rowValue, { color: status.dataReady ? colors.good : colors.textMuted }]}>
              {status.dataReady ? 'ready to upload' : 'none'}
            </Text>
          </View>
          <View style={st.row}>
            <Text style={st.rowLabel}>Samples</Text>
            <Text style={st.rowValue}>{status.bufCount} / {status.maxSamples}</Text>
          </View>
          <Text style={st.detail}>
            {status.bufCount === 0
              ? 'Buffer is empty — if a recording "wasn\'t found", the swim never recorded (often the magnet was not detected at the start).'
              : 'Samples are buffered on the device and ready to retrieve.'}
          </Text>
        </View>

        {/* ── Connection ── */}
        <Text style={st.sectionLabel}>CONNECTION</Text>
        <View style={st.card}>
          <View style={st.row}>
            <Text style={st.rowLabel}>Device</Text>
            <Text style={st.rowValue}>{connectedDevice?.name ?? 'SwimLogger'}</Text>
          </View>
          <View style={st.row}>
            <Text style={st.rowLabel}>Link</Text>
            <Text style={[st.rowValue, { color: stale ? colors.needsWork : colors.good }]}>
              {stale ? 'no response' : 'live'}
            </Text>
          </View>
          <View style={st.row}>
            <Text style={st.rowLabel}>Last status</Text>
            <Text style={st.rowValue}>{ageS == null ? '—' : `${ageS}s ago`}</Text>
          </View>
          {status.motorRunning ? (
            <Text style={st.detail}>Reel motor is running.</Text>
          ) : null}
        </View>
      </>
    );
  };

  return (
    <SafeAreaView style={st.container}>
      <View style={st.header}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Text style={st.back}>‹ Devices</Text>
        </TouchableOpacity>
        <Text style={st.title}>DIAGNOSTICS</Text>
        <View style={{ width: 80 }} />
      </View>
      <ScrollView contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 24 }}>
        {renderBody()}
      </ScrollView>
    </SafeAreaView>
  );
}

const st = StyleSheet.create({
  container:    { flex: 1, backgroundColor: colors.bg },
  header:       { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, marginTop: 16, marginBottom: 16 },
  back:         { color: colors.primary, fontSize: 14, width: 80 },
  title:        { color: colors.text, fontSize: 15, fontWeight: '700', letterSpacing: 1 },

  sectionLabel: { color: colors.textSecondary, fontSize: 11, fontWeight: '600', letterSpacing: 1, textTransform: 'uppercase', marginBottom: 10, marginTop: 8 },
  card:         { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: 10, padding: 16, marginBottom: 12 },
  row:          { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 4 },
  rowLabel:     { color: colors.textSecondary, fontSize: 14 },
  rowValue:     { color: colors.text, fontSize: 16, fontWeight: '700' },
  detail:       { color: colors.textMuted, fontSize: 12, lineHeight: 17, marginTop: 4 },
  divider:      { borderTopWidth: 1, borderTopColor: colors.border, marginVertical: 12 },
  empty:        { color: colors.textMuted, textAlign: 'center', marginTop: 40, lineHeight: 22 },
});
