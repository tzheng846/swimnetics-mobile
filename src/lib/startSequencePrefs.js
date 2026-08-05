import * as SecureStore from 'expo-secure-store';

// Persisted on/off for the race-start sequence. Defaults ON when never set.
const KEY = 'startSequenceEnabled';

export async function getStartSequenceEnabled() {
  try {
    const v = await SecureStore.getItemAsync(KEY);
    return v === null ? true : v === '1';
  } catch {
    return true;
  }
}

export async function setStartSequenceEnabled(enabled) {
  try {
    await SecureStore.setItemAsync(KEY, enabled ? '1' : '0');
  } catch {
    // best-effort; toggle still works for this session
  }
}
