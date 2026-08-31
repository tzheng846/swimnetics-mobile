# CLAUDE.md — swimnetics-mobile

iOS app for Swimnetics. React Native + Expo bare workflow (SDK 56, RN 0.85.3, Hermes). Distributed via TestFlight / EAS Build.

## What this app does

Coaches use this to record tethered swim sessions via Bluetooth LE, upload the raw data to the backend, and view stroke metrics on their phone — no laptop at poolside.

**Data flow — what this app stores locally vs in Supabase, which endpoints it calls, and which
tables it reads directly: see `DATA-FLOW.md` in the backend repo
(`C:\Users\TonyZheng\Desktop\myswimcoach\DATA-FLOW.md`, 2026-08-13).** It maps both repos; every
mobile caller in it is cited as `file:line` against this `src/`.

**Cross-repo folder map + build/deploy state: see `CODEBASE-AUDIT.md` in the backend repo (`Desktop/myswimcoach`, 2026-06-12).** ⚠ Its §4 connection matrix is superseded by DATA-FLOW.md.

## System connections

```
Device (ESP32 + AS5600, firmware 1.1.0 — buffer-and-dump)
  ← BLE (Nordic UART) → BleContext (connection) + RecordScreen (retrieval)
      device records into RAM via its button (no phone needed)
      META → clock correlation → DUMP → samples → CSV (FileSystem.documentDirectory)
      → FileSystem.uploadAsync → POST /process (Railway FastAPI)
              → metrics JSON displayed in RecordScreen / ReportCardScreen

Supabase (ujrotuijxrbscjhzekjk.supabase.co)
  → Auth: coach login / JWT (src/lib/supabase.js + src/context/AuthContext.js)
  → Postgres: sessions, athletes, coaches (read via supabase-js)

Backend: https://swimnetics-api-production.up.railway.app  (src/config.js API_BASE)
  → POST /process, PATCH/DELETE /sessions/:id, POST /athletes,
    GET /devices, PATCH/DELETE /devices/:chip_id
```

## App structure

```
src/
├── config.js                 — API_BASE URL + Supabase URL/anon key
├── lib/supabase.js           — Supabase client (anon key)
├── context/AuthContext.js    — coach JWT session, signIn/signOut
├── context/BleContext.js     — app-lifetime BLE singleton; known devices in SecureStore;
│                               chipId derived from BLE name "SwimLogger-XXXXXX"
├── components/
│   ├── VelocityChart.js      — shared SVG velocity chart (interactive: cursor, zoom, pan)
│   └── DataQualityCard.js    — magnet dropout + plausibility display
└── screens/
    ├── LoginScreen.js        — Supabase email/password auth
    ├── AthletesScreen.js     — team roster + dashboard (latest metrics per athlete)
    ├── DevicesScreen.js      — pair/scan flow + device list/rename/deregister (gear icon)
    ├── RecordingConfigScreen.js — pre-session: stroke type, name, notes, device picker
    ├── RecordScreen.js       — buffer-and-dump retrieval → upload → results
    ├── SessionHistoryScreen.js — per-athlete session list (filter, star, swipe-delete)
    └── ReportCardScreen.js   — historical session report card (editable name/notes/star)
```

## Key files

### `src/config.js`
Single export: `API_BASE`. Change this to point at local dev server when needed.

### `src/lib/supabase.js`
Supabase client initialized with anon key. Used by AuthContext and screens for DB reads.

### `src/screens/RecordScreen.js`
The most complex screen. Connection comes from BleContext (no scan/connect UI here).
Retrieval flow since the firmware moved to buffer-and-dump (the device records into
RAM via its own button — the phone retrieves afterwards):
`ready → retrieving (META → clock correlation → DUMP) → saving → uploading → results`.

Key refs:
- `samplesRef` — accumulates decoded 7-byte samples during DUMP
- `deviceRef` — connected BLE device (from BleContext)
- `subscriptionRef` — TX notification watcher; stall timer guards an incomplete dump

BLE protocol (buffer-and-dump, firmware 1.1.0 — full locked spec in backend repo
`.paul/STATE.md`):
```
NUS Service:  6E400001-B5A3-F393-E0A9-E50E24DCCA9E
TX (notify):  6E400003-...  — sample packets: any non-zero multiple of 7 bytes
RX (write):   6E400002-...  — START / STOP / META / DUMP / REEL_ON / REEL_OFF (write-with-response)
Sample:       7 B = [uint32 ts_us][uint16 angle_counts][uint8 magnet_ok] LE
META reply:   exactly 8 B = [session_start_us u32][device_now_us u32] LE (start==0 → none)
End of dump:  exactly 1 B = 0xEE (buffer cleared on device after complete dump)
Clock sync:   sessionStartPhoneMs = phoneNowMs − ((deviceNowUs − sessionStartUs + 2^32) % 2^32)/1000
```

Upload: `FileSystem.uploadAsync` (MULTIPART) — not `fetch + FormData` (rejected by RN 0.85).
Sends: file, athlete_id, head_waist_m, stroke_type, name, notes, device_id (chipId).
Note: `firmware_version` is accepted by the API but not sent (the FW read
characteristic 6E400005 is not consumed) — known gap.

The live velocity graph during recording was removed in Phase 21-02 — dump mode has
no in-swim data.

### `src/components/VelocityChart.js`
Shared chart component used in both RecordScreen (results) and ReportCardScreen.

Props:
- `time` / `velocity` — arrays of equal length
- `markerTimeS` — absolute timestamp for the orange distance marker line
- `markerLabel` — label shown above marker
- `unitFactor` / `unitLabel` — for m/s ↔ yd/s conversion
- `interactive` — enables PanResponder (touch cursor, pinch-to-zoom, pan-when-zoomed)

Gesture behavior:
- Not zoomed: single-finger drag → velocity cursor tooltip (fades after 2s)
- Zoomed: single-finger drag → pans the zoom window
- Two fingers: pinch scales the time axis; double-tap resets zoom
- "Reset zoom" pill appears below chart when zoomed

## Running

```bash
# Metro bundler (development)
npx expo start

# EAS build + submit to TestFlight
eas build --profile preview --platform ios --auto-submit
```

## Key constraints

- **Hermes engine**: no `.mjs` dynamic imports — Supabase uses a Metro CJS redirect
- **`FileSystem.uploadAsync`** not `fetch+FormData` — RN 0.85 rejects the FormData multipart pattern
- **Subscribe BEFORE writing commands** — META/DUMP replies arrive immediately
- **`writeCharacteristicWithResponseForService`** for NUS RX — the RX char requires write-with-response
- **`gestureEnabled: false`** on RecordScreen and ReportCardScreen — prevents iOS swipe-back conflicting with chart gestures
- EAS project ID: `db87ba35-184b-4469-a291-559775c12191` (in `app.json`)
- Bundle ID: `com.swimnetics.app` (App Store Connect: 6772050809)

## Expo version notes

SDK 56 / RN 0.85.3. Check versioned docs at https://docs.expo.dev/versions/v56.0.0/ before using any Expo API — APIs change between SDK versions.

`expo-file-system` legacy import required: `import * as FileSystem from 'expo-file-system/legacy'` — `writeAsStringAsync` deprecated in SDK 56.
