import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View, Text, TouchableOpacity, FlatList,
  ActivityIndicator, SafeAreaView, StyleSheet,
  TextInput, Alert,
} from 'react-native';
import { useAuth } from '../context/AuthContext';
import { useBle } from '../context/BleContext';
import { API_BASE } from '../config';

export default function DevicesScreen({ navigation }) {
  const { session } = useAuth();
  const { manager, connectedDevice, connectionStatus, knownDevices, connectToDevice, forgetDevice } = useBle();

  // ── Supabase-registered devices ───────────────────────────────────────────────
  const [devices, setDevices]             = useState([]);
  const [loading, setLoading]             = useState(true);
  const [editingChipId, setEditingChipId] = useState(null);
  const [editName, setEditName]           = useState('');

  const authHeader = session?.access_token
    ? { Authorization: `Bearer ${session.access_token}` }
    : {};

  const fetchDevices = useCallback(async () => {
    try {
      const resp = await fetch(`${API_BASE}/devices`, { headers: authHeader });
      if (resp.ok) {
        const body = await resp.json();
        setDevices(body.devices ?? []);
      }
    } catch { /* non-fatal */ } finally {
      setLoading(false);
    }
  }, [session]);

  useEffect(() => { fetchDevices(); }, [fetchDevices]);

  const handleRename = async (chipId) => {
    const name = editName.trim();
    setEditingChipId(null);
    if (!name) return;
    setDevices(prev => prev.map(d => d.chip_id === chipId ? { ...d, name } : d));
    try {
      await fetch(`${API_BASE}/devices/${chipId}`, {
        method: 'PATCH',
        headers: { ...authHeader, 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      });
    } catch { /* non-fatal — optimistic update already applied */ }
  };

  const handleRemove = (device) => {
    Alert.alert(
      'Remove Device',
      `Remove "${device.name || device.chip_id}"?\n\nIt will re-register automatically next time it's used.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove', style: 'destructive',
          onPress: async () => {
            setDevices(prev => prev.filter(d => d.chip_id !== device.chip_id));
            try {
              await fetch(`${API_BASE}/devices/${device.chip_id}`, {
                method: 'DELETE',
                headers: authHeader,
              });
            } catch {
              fetchDevices();
            }
          },
        },
      ],
    );
  };

  // ── Pair new device (BLE scan) ─────────────────────────────────────────────────
  const [pairScanning, setPairScanning] = useState(false);
  const [pairFound, setPairFound]       = useState([]);
  const [pairConnecting, setPairConnecting] = useState(null); // bleId being connected
  const pairTimerRef = useRef(null);
  const pairSeenRef  = useRef(new Set());

  const startPairScan = () => {
    setPairFound([]);
    pairSeenRef.current = new Set();
    setPairScanning(true);

    manager.startDeviceScan(null, { allowDuplicates: false }, (error, device) => {
      if (error) { setPairScanning(false); return; }
      if (device?.name?.startsWith('SwimLogger') && !pairSeenRef.current.has(device.id)) {
        pairSeenRef.current.add(device.id);
        setPairFound(prev => [...prev, { id: device.id, name: device.name }]);
      }
    });

    pairTimerRef.current = setTimeout(() => {
      manager.stopDeviceScan();
      setPairScanning(false);
    }, 8000);
  };

  const cancelPairScan = () => {
    clearTimeout(pairTimerRef.current);
    manager.stopDeviceScan();
    setPairScanning(false);
    setPairFound([]);
  };

  const handlePairDevice = async (bleId) => {
    clearTimeout(pairTimerRef.current);
    manager.stopDeviceScan();
    setPairScanning(false);
    setPairConnecting(bleId);
    try {
      await connectToDevice(bleId);
    } catch (e) {
      Alert.alert('Connection Failed', e.message ?? 'Could not connect to device.');
    } finally {
      setPairConnecting(null);
      setPairFound([]);
    }
  };

  // ── Helpers ────────────────────────────────────────────────────────────────────
  const fmtDate = (iso) => {
    if (!iso) return '–';
    return new Date(iso).toLocaleDateString('en-US', {
      month: 'short', day: 'numeric', year: 'numeric',
    });
  };

  const chipSuffix = (chipId) => chipId ? '…' + chipId.slice(-8) : '–';

  // ── Render registered device card ──────────────────────────────────────────────
  const renderDevice = ({ item }) => (
    <View style={st.card}>
      <View style={st.cardTop}>
        {editingChipId === item.chip_id ? (
          <TextInput
            style={st.nameInput}
            value={editName}
            onChangeText={setEditName}
            onBlur={() => handleRename(item.chip_id)}
            autoFocus
            returnKeyType="done"
            selectTextOnFocus
          />
        ) : (
          <TouchableOpacity
            onPress={() => { setEditingChipId(item.chip_id); setEditName(item.name || ''); }}
          >
            <Text style={st.deviceName}>{item.name || 'Unnamed Device'}</Text>
          </TouchableOpacity>
        )}
        <Text style={st.chipId}>{chipSuffix(item.chip_id)}</Text>
      </View>

      <View style={st.statsRow}>
        <View style={st.statCol}>
          <Text style={st.statLabel}>FIRMWARE</Text>
          <Text style={st.statValue}>{item.firmware_version || '–'}</Text>
        </View>
        <View style={st.statCol}>
          <Text style={st.statLabel}>LAST ACTIVE</Text>
          <Text style={st.statValue}>{fmtDate(item.last_seen_at)}</Text>
        </View>
        <View style={st.statCol}>
          <Text style={st.statLabel}>SESSIONS</Text>
          <Text style={st.statValue}>{item.session_count ?? 0}</Text>
        </View>
      </View>

      <TouchableOpacity style={st.removeBtn} onPress={() => handleRemove(item)}>
        <Text style={st.removeBtnText}>Remove</Text>
      </TouchableOpacity>
    </View>
  );

  // ── Header component for FlatList ──────────────────────────────────────────────
  const ListHeader = () => (
    <View>
      {/* PAIRED DEVICES (local BLE pairing) */}
      <Text style={st.sectionLabel}>PAIRED DEVICES</Text>

      {knownDevices.length === 0 ? (
        <Text style={st.emptyPaired}>No paired devices yet.</Text>
      ) : (
        knownDevices.map(d => {
          const isConnected = connectedDevice?.id === d.bleId && connectionStatus === 'connected';
          return (
            <View key={d.bleId} style={st.pairedRow}>
              {isConnected && <View style={st.connectedDot} />}
              <View style={{ flex: 1 }}>
                <Text style={st.pairedName}>{d.name}</Text>
                {d.chipId ? <Text style={st.pairedChip}>{d.chipId}</Text> : null}
              </View>
              <TouchableOpacity onPress={() => forgetDevice(d.bleId)}>
                <Text style={st.forgetBtn}>Forget</Text>
              </TouchableOpacity>
            </View>
          );
        })
      )}

      {/* Pair new device */}
      {!pairScanning ? (
        <TouchableOpacity style={st.pairBtn} onPress={startPairScan}>
          <Text style={st.pairBtnText}>+ Pair New Device</Text>
        </TouchableOpacity>
      ) : (
        <View style={st.scanningRow}>
          <ActivityIndicator color="#2196F3" />
          <Text style={st.scanningText}> Scanning for SwimLogger…</Text>
          <TouchableOpacity onPress={cancelPairScan} style={{ marginLeft: 8 }}>
            <Text style={st.cancelText}>Cancel</Text>
          </TouchableOpacity>
        </View>
      )}

      {pairFound.map(d => (
        <TouchableOpacity
          key={d.id}
          style={st.foundItem}
          onPress={() => handlePairDevice(d.id)}
          disabled={pairConnecting === d.id}
        >
          {pairConnecting === d.id
            ? <ActivityIndicator color="#2196F3" />
            : <Text style={st.foundName}>{d.name}</Text>
          }
        </TouchableOpacity>
      ))}

      {/* Diagnostics — live magnet/wiring/buffer/link health for the connected device */}
      <TouchableOpacity style={st.diagBtn} onPress={() => navigation.navigate('Diagnostics')}>
        <Text style={st.diagBtnText}>🔧 Run Diagnostics</Text>
      </TouchableOpacity>

      {/* Divider */}
      <View style={st.divider} />
      <Text style={st.sectionLabel}>REGISTERED DEVICES</Text>
    </View>
  );

  return (
    <SafeAreaView style={st.container}>
      <View style={st.header}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Text style={st.back}>‹ Athletes</Text>
        </TouchableOpacity>
        <Text style={st.title}>DEVICES</Text>
        <View style={{ width: 80 }} />
      </View>

      {loading ? (
        <ActivityIndicator color="#2196F3" style={{ marginTop: 40 }} />
      ) : (
        <FlatList
          data={devices}
          keyExtractor={d => d.chip_id}
          renderItem={renderDevice}
          extraData={editingChipId}
          ListHeaderComponent={ListHeader}
          contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 24 }}
          ListEmptyComponent={
            <Text style={st.empty}>
              No registered devices.{'\n'}Start a recording session to register your encoder.
            </Text>
          }
        />
      )}
    </SafeAreaView>
  );
}

const st = StyleSheet.create({
  container:     { flex: 1, backgroundColor: '#000' },
  header:        { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, marginTop: 16, marginBottom: 16 },
  back:          { color: '#2196F3', fontSize: 14, width: 80 },
  title:         { color: '#fff', fontSize: 15, fontWeight: '700', letterSpacing: 1 },

  // Section labels
  sectionLabel:  { color: '#888', fontSize: 11, fontWeight: '600', letterSpacing: 1, textTransform: 'uppercase', marginBottom: 10, marginTop: 4 },
  divider:       { borderTopWidth: 1, borderTopColor: '#222', marginVertical: 16 },

  // Paired devices list
  emptyPaired:   { color: '#555', fontSize: 13, marginBottom: 8 },
  pairedRow:     { flexDirection: 'row', alignItems: 'center', paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#222' },
  connectedDot:  { width: 8, height: 8, borderRadius: 4, backgroundColor: '#27AE60', marginRight: 8 },
  pairedName:    { color: '#fff', fontSize: 15, fontWeight: '500' },
  pairedChip:    { color: '#555', fontSize: 11, marginTop: 2 },
  forgetBtn:     { color: '#C0392B', fontSize: 12, fontWeight: '600', paddingHorizontal: 4 },

  // Scan UI
  pairBtn:       { backgroundColor: '#1a1a1a', borderWidth: 1, borderColor: '#333', borderRadius: 8, padding: 12, alignItems: 'center', marginTop: 10, marginBottom: 4 },
  pairBtnText:   { color: '#2196F3', fontSize: 14, fontWeight: '600' },
  scanningRow:   { flexDirection: 'row', alignItems: 'center', paddingVertical: 12 },
  scanningText:  { color: '#aaa', fontSize: 14 },
  cancelText:    { color: '#C0392B', fontSize: 13, fontWeight: '600' },
  foundItem:     { backgroundColor: '#252525', borderRadius: 8, padding: 12, marginBottom: 8, marginTop: 4 },
  foundName:     { color: '#fff', fontSize: 15, fontWeight: '500' },

  // Diagnostics entry
  diagBtn:       { backgroundColor: '#1a1a1a', borderWidth: 1, borderColor: '#333', borderRadius: 8, padding: 12, alignItems: 'center', marginTop: 12 },
  diagBtnText:   { color: '#fff', fontSize: 14, fontWeight: '600' },

  // Registered device cards
  card:          { backgroundColor: '#1a1a1a', borderRadius: 10, padding: 16, marginBottom: 12 },
  cardTop:       { marginBottom: 14 },
  deviceName:    { color: '#fff', fontSize: 17, fontWeight: '600' },
  nameInput:     { color: '#fff', fontSize: 17, fontWeight: '600', borderBottomWidth: 1, borderBottomColor: '#2563EB', paddingVertical: 2 },
  chipId:        { color: '#555', fontSize: 11, marginTop: 4 },
  statsRow:      { flexDirection: 'row', marginBottom: 14 },
  statCol:       { flex: 1 },
  statLabel:     { color: '#666', fontSize: 10, fontWeight: '600', letterSpacing: 0.5, marginBottom: 4 },
  statValue:     { color: '#fff', fontSize: 14, fontWeight: '600' },
  removeBtn:     { alignSelf: 'flex-end' },
  removeBtnText: { color: '#C0392B', fontSize: 13, fontWeight: '600' },
  empty:         { color: '#555', textAlign: 'center', marginTop: 20, lineHeight: 22 },
});
