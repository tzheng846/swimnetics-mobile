import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { BleManager } from 'react-native-ble-plx';
import * as SecureStore from 'expo-secure-store';

const STORAGE_KEY = 'swimnetics_known_devices';

// Module-level singleton — one BLE stack for the whole app lifetime.
const manager = new BleManager();

const BleContext = createContext(null);

export function BleProvider({ children }) {
  const [connectedDevice, setConnectedDevice]     = useState(null);
  const [connectionStatus, setConnectionStatus]   = useState('disconnected');
  const [knownDevices, setKnownDevices]           = useState([]);
  const disconnectListenerRef = useRef(null);

  // Load known devices from storage on mount
  useEffect(() => {
    SecureStore.getItemAsync(STORAGE_KEY).then(json => {
      if (json) {
        try { setKnownDevices(JSON.parse(json)); } catch { /* corrupt — ignore */ }
      }
    });
  }, []);

  // On foreground: verify the connection is still alive
  useEffect(() => {
    const sub = AppState.addEventListener('change', async (next) => {
      if (next === 'active' && connectedDevice) {
        const still = await connectedDevice.isConnected().catch(() => false);
        if (!still) {
          disconnectListenerRef.current?.remove();
          disconnectListenerRef.current = null;
          setConnectedDevice(null);
          setConnectionStatus('disconnected');
        }
      }
    });
    return () => sub.remove();
  }, [connectedDevice]);

  const _persistDevices = async (devices) => {
    setKnownDevices(devices);
    await SecureStore.setItemAsync(STORAGE_KEY, JSON.stringify(devices));
  };

  // Connect to a device by its BLE ID (no scan needed if ID is known).
  // Derives chipId from device.name — firmware uses "SwimLogger-XXXXXX" format.
  const connectToDevice = async (bleId) => {
    setConnectionStatus('connecting');
    try {
      const device = await manager.connectToDevice(bleId);
      await device.discoverAllServicesAndCharacteristics();

      // Derive chipId from BLE name ("SwimLogger-A1B2C3" → "A1B2C3")
      const chipId = device.name?.startsWith('SwimLogger-')
        ? device.name.replace('SwimLogger-', '')
        : null;

      // Store device if not already known
      setKnownDevices(prev => {
        if (prev.find(d => d.bleId === bleId)) return prev;
        const updated = [...prev, { bleId, name: device.name ?? 'SwimLogger', chipId }];
        SecureStore.setItemAsync(STORAGE_KEY, JSON.stringify(updated));
        return updated;
      });

      // Watch for unexpected disconnects
      disconnectListenerRef.current?.remove();
      disconnectListenerRef.current = device.onDisconnected(() => {
        disconnectListenerRef.current = null;
        setConnectedDevice(null);
        setConnectionStatus('disconnected');
      });

      setConnectedDevice(device);
      setConnectionStatus('connected');
      return device;
    } catch (e) {
      setConnectionStatus('disconnected');
      throw e;
    }
  };

  const forgetDevice = async (bleId) => {
    // If we're forgetting the device we're currently connected to, drop the BLE link too —
    // otherwise the radio stays connected (device LED stays on) and our state goes stale.
    if (connectedDevice?.id === bleId) {
      disconnectListenerRef.current?.remove();
      disconnectListenerRef.current = null;
      await connectedDevice.cancelConnection().catch(() => {});
      setConnectedDevice(null);
      setConnectionStatus('disconnected');
    }
    const updated = knownDevices.filter(d => d.bleId !== bleId);
    await _persistDevices(updated);
  };

  const disconnect = async () => {
    disconnectListenerRef.current?.remove();
    disconnectListenerRef.current = null;
    if (connectedDevice) {
      await connectedDevice.cancelConnection().catch(() => {});
    }
    setConnectedDevice(null);
    setConnectionStatus('disconnected');
  };

  return (
    <BleContext.Provider value={{
      manager,
      connectedDevice,
      connectionStatus,
      knownDevices,
      connectToDevice,
      forgetDevice,
      disconnect,
    }}>
      {children}
    </BleContext.Provider>
  );
}

export const useBle = () => useContext(BleContext);
