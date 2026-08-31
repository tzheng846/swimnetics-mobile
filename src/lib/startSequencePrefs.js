import * as SecureStore from 'expo-secure-store';

// Persisted on/off for the race-start sequence. Defaults OFF as of Phase 84: the phone
// speaker is inaudible poolside, so the countdown and horn cue nobody — and because the
// horn blares BEFORE writeCmd('START'), it made an honest coach GO stamp resolve negative
// and therefore unusable. The feature is switched off, not deleted: the toggle in
// Recording Config still works and still persists, and useStartSequence /
// StartSequenceOverlay / the audio assets are all untouched.
//
// ⚠ The key is bumped to .v2 deliberately. A default flip alone would only reach users who
// never touched the toggle; anyone who explicitly switched the sequence ON still has '1'
// under the old key — i.e. exactly the users who chose the feature would be the ones who
// kept hearing the horn. Bumping discards every stored value once so everyone lands on the
// new default. The old key is left in SecureStore; it is two bytes and migrating it buys
// nothing.
const KEY = 'startSequenceEnabled.v2';

export async function getStartSequenceEnabled() {
  try {
    const v = await SecureStore.getItemAsync(KEY);
    return v === null ? false : v === '1';
  } catch {
    // Fail closed: a SecureStore read failure must land on silence, not on a horn.
    return false;
  }
}

export async function setStartSequenceEnabled(enabled) {
  try {
    await SecureStore.setItemAsync(KEY, enabled ? '1' : '0');
  } catch {
    // best-effort; toggle still works for this session
  }
}
