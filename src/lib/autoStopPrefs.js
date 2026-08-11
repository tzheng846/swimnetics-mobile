import * as SecureStore from 'expo-secure-store';

// Persisted auto-stop duration in seconds — the device (and, in video mode, the camera)
// stop themselves this long after START. Defaults to 20 s when never set.
//
// 0 means DISABLED. Encoding "off" as 0 rather than adding a second boolean key keeps this
// to one entry and lets every consumer gate on the same `autoStopS > 0` check.
const KEY = 'autoStopSeconds';

export const DEFAULT_AUTO_STOP_S = 20;

// 300 s matches recordAsync({ maxDuration: 300 }) in RecordScreen — a longer auto-stop
// could not be honoured in video mode, so it is not offerable.
const MAX_AUTO_STOP_S = 300;
const MIN_AUTO_STOP_S = 5;

export async function getAutoStopS() {
  try {
    const v = await SecureStore.getItemAsync(KEY);
    if (v === null) return DEFAULT_AUTO_STOP_S;
    const n = parseInt(v, 10);
    return Number.isFinite(n) ? n : DEFAULT_AUTO_STOP_S;
  } catch {
    return DEFAULT_AUTO_STOP_S;
  }
}

export async function setAutoStopS(seconds) {
  const n = clampAutoStopS(seconds);
  try {
    await SecureStore.setItemAsync(KEY, String(n));
  } catch {
    // best-effort; the value still applies for this session
  }
  return n;
}

// Non-positive → 0 (disabled). Otherwise held inside [MIN, MAX].
export function clampAutoStopS(seconds) {
  const n = Number(seconds);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.min(MAX_AUTO_STOP_S, Math.max(MIN_AUTO_STOP_S, Math.round(n)));
}
