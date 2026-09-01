// sessionClock — what absolute UTC instant was encoder sample #0? (Phase 86-02).
//
// PURE by design: no imports at all, mirroring src/lib/uploadRetry.js. That is what lets
// scratch/session_clock_check.mjs in the backend repo import() this file through a data: URL and
// assert on it — the mobile tree has no test runner (84-03 G28), so a module with zero imports is
// the only kind that can be checked headlessly. No React, no state, and deliberately no Date.now()
// inside: every caller passes its timestamps in, so the harness is deterministic.
//
// Why it exists: every encoder sample is stamped micros() — boot-relative, wrapping at 71.6 min.
// The ONLY bridge to absolute time is the 8-byte META reply, which carries (sessionStartUs,
// deviceNowUs). deviceNowUs is captured on the ESP32 when it BUILDS the reply, not when the phone
// receives it, so the inbound BLE leg (20–80 ms) used to be silently attributed to the encoder and
// sessionStartPhoneMs came out biased LATE by roughly one one-way flight time. That number drives
// the in-app video overlay, so this was a live defect, not partner-driven work.
//
// ⚠ clockOffsetMs is MEASURED AND REPORTED, NEVER APPLIED to session_start_utc_ms. The app records
// at poolside, where GET /time may fail entirely; applying the offset would make the meaning of the
// primary number depend on whether an unrelated network call happened to succeed. session_start_utc_ms
// is therefore always "on the phone's clock, corrected for BLE flight only" — one definition, every
// session, whether or not the phone had a network. This matches api.py:292-297 ("the diagnostics are
// NOT corrections").

// ── Probe burst tuning ───────────────────────────────────────────────────────────
// 10 probes at an expected 20–80 ms RTT costs well under a second, in front of a ~20 s dump — so
// the burst is free in wall-clock terms. The per-probe timeout is generous against a 15–30 ms BLE
// connection interval (a reply that has not landed in 400 ms is lost, not slow). The budget is the
// hard ceiling: a dead link burns 2.5 s and then retrieval proceeds exactly as it would have.
export const META_PROBE_COUNT      = 10;
export const META_PROBE_TIMEOUT_MS = 400;
export const META_PROBE_BUDGET_MS  = 2500;

// ── Mirrors of api.py:133-134 — the server's plausibility window ─────────────────
// ⚠ SECOND COPY. api.py's _EPOCH_MS_FLOOR / _EPOCH_MS_FUTURE_SLACK_MS are AUTHORITATIVE (the server
// enforces them). Nothing imports across the backend/mobile repo boundary, so the values are
// duplicated rather than shared — and scratch/session_clock_check.mjs parses api.py and FAILS if
// these copies drift.
//
// Why the drift matters: a value outside the server's window is dropped inside the handler with a
// print() the phone never sees. No 4xx, no symptom, and the session's absolute start is gone
// permanently (no backfill is possible — only the phone can produce this, at record time). That is
// the same silent-loss shape Phase 84-02 was written to avoid, so the phone refuses to send what
// the server would silently discard.
export const EPOCH_MS_FLOOR           = 1577836800000;  // 2020-01-01T00:00:00Z — predates the hardware
export const EPOCH_MS_FUTURE_SLACK_MS = 48 * 3600 * 1000; // tolerate a phone clock up to 2 days fast

// uint32 modular subtraction — the device clock is micros(), which wraps at 2^32 (71.6 min). Moved
// here verbatim from RecordScreen's META handler so the wrap handling is testable. Arithmetic
// unchanged.
export function elapsedUs(deviceNowUs, sessionStartUs) {
  return (deviceNowUs - sessionStartUs + 2 ** 32) % 2 ** 32;
}

// A probe is { tSendMs, tRecvMs, sessionStartUs, deviceNowUs }: the phone-clock instants either side
// of one META round trip, plus the two device-clock numbers that reply carried.
export function probeRttMs(probe) {
  return probe.tRecvMs - probe.tSendMs;
}

// The MINIMUM-RTT probe — not the mean, not the median, not the first.
//
// Cristian's algorithm: the correction below assumes the two BLE legs are symmetric, and the
// least-delayed sample is the one whose symmetry assumption is least polluted by queueing. Averaging
// would bake congestion delay straight into the correction, which is the error we are removing.
export function pickBestProbe(probes) {
  if (!Array.isArray(probes) || probes.length === 0) return null;
  let best = null;
  for (const p of probes) {
    if (!p || !Number.isFinite(probeRttMs(p))) continue;
    if (best === null || probeRttMs(p) < probeRttMs(best)) best = p;
  }
  return best;
}

// The corrected absolute start: (tRecvMs − rtt/2) − elapsedUs/1000.
//
// Derivation: deviceNowUs was captured when the ESP32 built the reply, so the phone-clock instant of
// that capture is tRecvMs minus the INBOUND leg — estimated as half the round trip. Subtracting the
// device-measured elapsed time from there walks back to encoder sample #0. The old one-shot used
// tRecvMs directly, i.e. it assumed the inbound leg was zero.
export function sessionStartUtcMsFrom(probe) {
  const arrivalOnPhone = probe.tRecvMs - probeRttMs(probe) / 2;
  return arrivalOnPhone - elapsedUs(probe.deviceNowUs, probe.sessionStartUs) / 1000;
}

// rtt/2 — simultaneously the correction that was applied and what remains uncertain about it. The
// residual is the leg ASYMMETRY, which is bounded by the round trip, so the same number honestly
// describes both. Reported as sync_error_ms.
export function syncErrorMsFrom(probe) {
  return probeRttMs(probe) / 2;
}

// Phone clock vs server clock, from one unauthenticated GET /time round trip.
//
// ⚠ SIGN: POSITIVE means the phone clock is AHEAD of the server. A consumer converts a phone-clock
// instant to server time with `session_start_utc_ms - clock_offset_ms`. An undocumented sign on a
// diagnostic is worse than no diagnostic at all.
export function clockOffsetMs({ tSendMs, tRecvMs, serverUtcMs }) {
  return (tSendMs + tRecvMs) / 2 - serverUtcMs;
}

// Would the server accept this as an absolute epoch-ms instant? Checked on the phone before sending,
// so a value the server would silently discard is never sent in the first place.
export function isPlausibleEpochMs(ms, nowMs) {
  if (typeof ms !== 'number' || !Number.isFinite(ms)) return false;
  if (Math.abs(ms) > Number.MAX_SAFE_INTEGER) return false;
  if (ms <= 0) return false;
  return ms >= EPOCH_MS_FLOOR && ms <= nowMs + EPOCH_MS_FUTURE_SLACK_MS;
}
