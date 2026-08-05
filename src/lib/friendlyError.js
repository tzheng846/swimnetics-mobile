import { State } from 'react-native-ble-plx';

// Short, specific, coach-readable reasons for BLE / connection failures.
// Used so pairing/recording never fail with a raw stack or a silent no-op.

// Adapter-state → reason. Returns null when ready (PoweredOn).
export function bleStateReason(state) {
  switch (state) {
    case State.PoweredOn:    return null;
    case State.PoweredOff:   return 'Bluetooth is off. Turn it on in Control Center, then try again.';
    case State.Unauthorized: return 'Bluetooth permission is denied. Enable it in Settings → Swimnetics.';
    case State.Unsupported:  return 'This device does not support Bluetooth.';
    case State.Resetting:    return 'Bluetooth is resetting. Wait a moment and try again.';
    default:                 return 'Bluetooth is not ready yet. Wait a moment and try again.';
  }
}

// Connection / operation error (react-native-ble-plx) → reason.
export function bleReason(error) {
  const code = error?.errorCode;
  const msg = error?.message || error?.reason || '';
  switch (code) {
    case 3:   return "Couldn't connect in time — make sure the device is on and nearby, then try again.";
    case 100: return 'This device does not support Bluetooth.';
    case 101: return 'Bluetooth permission is denied. Enable it in Settings → Swimnetics.';
    case 102: return 'Bluetooth is off. Turn it on in Control Center, then try again.';
    case 201:
    case 203: return 'The device disconnected. Reconnect and try again.';
    case 300:
    case 301:
    case 302: return "Connected, but couldn't read the device's services. Move closer and try again.";
    default:
      if (/tim(e|ed)?\s*out/i.test(msg)) return "Couldn't connect in time — make sure the device is on and nearby, then try again.";
      if (/cancell?ed/i.test(msg))       return 'Connection was cancelled.';
      return msg ? `Couldn't connect: ${msg}` : "Couldn't connect to the device. Try again.";
  }
}

// Upload / network error → reason. `status` is the HTTP status when there is one.
export function uploadReason(error, status) {
  if (status != null && status >= 500) return `Server error (${status}) — try again in a moment. Your session is saved on your phone.`;
  if (status != null && status >= 400) return `The server rejected the upload (${status}). Your session is saved on your phone.`;
  const msg = error?.message || '';
  if (/network|fetch|timeout|connection|offline|unreachable/i.test(msg)) {
    return 'You appear to be offline — your session is saved on your phone. Reconnect and tap Retry.';
  }
  if (/json|parse|unexpected/i.test(msg)) {
    return "Couldn't read the server's response. Your session is saved on your phone — tap Retry.";
  }
  return msg ? `Upload failed: ${msg}. Your session is saved on your phone.` : 'Upload failed. Your session is saved on your phone.';
}
