import * as SecureStore from 'expo-secure-store';

// Persisted camera lens for video recording — 'back' (default) or 'front' (Phase 84-05).
//
// A pref rather than an in-session control by necessity: expo-camera's `facing` prop swaps the
// capture session's input device (CameraSessionManager.updateDevice), which cannot be done mid-
// recording, and RecordScreen has no pre-recording preview to flip from — onCameraReady writes
// START and calls recordAsync immediately. So the choice has to be made before the session starts.
const KEY = 'cameraFacing';

export const DEFAULT_CAMERA_FACING = 'back';

const VALID = ['back', 'front'];

export async function getCameraFacing() {
  try {
    const v = await SecureStore.getItemAsync(KEY);
    return VALID.includes(v) ? v : DEFAULT_CAMERA_FACING;
  } catch {
    return DEFAULT_CAMERA_FACING;
  }
}

export async function setCameraFacing(facing) {
  const v = VALID.includes(facing) ? facing : DEFAULT_CAMERA_FACING;
  try {
    await SecureStore.setItemAsync(KEY, v);
  } catch {
    // best-effort; the value still applies for this session
  }
  return v;
}
