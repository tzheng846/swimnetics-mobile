# Agent / AI Guidance — swimnetics-mobile

## Expo SDK version

This project uses **Expo SDK 56 / React Native 0.85.3**. APIs change between SDK versions.
Always check versioned docs: https://docs.expo.dev/versions/v56.0.0/

Known SDK 56 changes that affect this codebase:
- `expo-file-system/legacy` import required (`writeAsStringAsync` deprecated in SDK 56)
- `FileSystem.uploadAsync` is the correct upload method — `fetch + FormData` is rejected by RN 0.85

## React Native constraints

- **Hermes engine** — no `.mjs` dynamic imports. Supabase requires a Metro CJS redirect (already configured in `metro.config.js`).
- **React Rules of Hooks** — all `useState`/`useRef` calls must appear before any early returns. Violations in `ReportCardScreen.js` caused runtime crashes.
- **PanResponder** — created once via `React.useRef`, handlers route through refs to avoid stale closures.

## Do not install new native dependencies

Any new native module requires a Mac rebuild (`npx expo prebuild`). The iOS native files are edited directly. Installing new packages that add native code will break the build until a Mac is available.

Approved libraries already in use: `react-native-ble-plx`, `react-native-svg`, `@supabase/supabase-js`, `expo-file-system`, `expo-secure-store`.

## BLE protocol is locked

Do not change the Nordic UART Service UUIDs, packet format, or command strings. The ESP32 firmware and iOS app must stay in sync. (Buffer-and-dump, firmware 1.1.0 — authoritative spec in the backend repo's `.paul/STATE.md`; full audit in its `CODEBASE-AUDIT.md`.)

```
NUS Service:  6E400001-B5A3-F393-E0A9-E50E24DCCA9E
TX (notify):  6E400003-B5A3-F393-E0A9-E50E24DCCA9E
RX (write):   6E400002-B5A3-F393-E0A9-E50E24DCCA9E  [write-with-response]
Device name:  "SwimLogger-<chipID>" (6 hex chars — chipId is parsed from the name)
Samples:      any non-zero multiple of 7 bytes; 7 B = [uint32 ts_us | uint16 angle_counts | uint8 magnet_ok] LE
META reply:   exactly 8 bytes = [session_start_us u32 LE][device_now_us u32 LE]; start==0 → no session
End of dump:  exactly 1 byte 0xEE
Commands:     START / STOP / META / DUMP / REEL_ON / REEL_OFF
```

## Upload pattern

```js
// CORRECT
FileSystem.uploadAsync(url, localPath, { uploadType: FileSystem.FileSystemUploadType.MULTIPART, ... })

// WRONG — rejected by RN 0.85
const formData = new FormData();
fetch(url, { method: 'POST', body: formData })
```
