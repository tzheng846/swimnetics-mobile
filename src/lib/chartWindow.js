// Phase 60 D7 — the windowing primitive shared by the report card's brush bar and (in 60-03) the
// video page's playhead-driven rolling window. Two drivers, one set of maths.
//
// Pure on purpose: there is no jest in this repo, so the only way to verify this without a paid EAS
// build is to import it in node. Same reason src/lib/dropoutWarning.js and src/lib/autoStopPrefs.js
// are shaped this way. Keep it free of React and react-native imports.
//
// Every function tolerates degenerate input (empty trace, zero-width span, zero-width chart) and
// returns something sane rather than NaN. One NaN here blanks the trace mid-playback on the video
// page, where this runs ~20 times a second.

/** Narrowest window the user can drag to. Matches the `> 0.5` guard the removed pinch code used. */
export const MIN_SPAN_S = 0.5;

/** First and last finite timestamp of a trace. */
export function fullRange(time) {
  if (!time || time.length === 0) return { tStart: 0, tEnd: 0 };
  let i = 0;
  while (i < time.length && !isFinite(time[i])) i++;
  let j = time.length - 1;
  while (j >= 0 && !isFinite(time[j])) j--;
  if (i > j) return { tStart: 0, tEnd: 0 };
  return { tStart: time[i], tEnd: time[j] };
}

/**
 * Keep a window inside the trace.
 *
 * `anchor` decides what is held fixed, because the three gestures want different things:
 *   'span'  — panning (drag the body): preserve width, slide until it hits a bound
 *   'start' — the RIGHT handle moved: hold tStart, move tEnd
 *   'end'   — the LEFT handle moved:  hold tEnd,  move tStart
 *
 * A window narrower than MIN_SPAN_S is widened; one wider than the trace collapses to the trace.
 */
export function clampWindow(win, tMin, tMax, anchor = 'span') {
  const traceSpan = tMax - tMin;
  if (!isFinite(traceSpan) || traceSpan <= 0) return { tStart: tMin, tEnd: tMin };
  if (!win) return { tStart: tMin, tEnd: tMax };

  let { tStart, tEnd } = win;
  if (!isFinite(tStart) || !isFinite(tEnd)) return { tStart: tMin, tEnd: tMax };
  if (tEnd < tStart) { const t = tStart; tStart = tEnd; tEnd = t; }

  const minSpan = Math.min(MIN_SPAN_S, traceSpan);

  if (anchor === 'start') {
    const s = Math.min(Math.max(tStart, tMin), tMax - minSpan);
    const e = Math.min(Math.max(tEnd, s + minSpan), tMax);
    return { tStart: s, tEnd: e };
  }

  if (anchor === 'end') {
    const e = Math.max(Math.min(tEnd, tMax), tMin + minSpan);
    const s = Math.max(Math.min(tStart, e - minSpan), tMin);
    return { tStart: s, tEnd: e };
  }

  // 'span' — preserve width while shifting into bounds
  let span = tEnd - tStart;
  if (span < minSpan) span = minSpan;
  if (span > traceSpan) span = traceSpan;
  let s = tStart;
  if (s < tMin) s = tMin;
  if (s + span > tMax) s = tMax - span;
  return { tStart: s, tEnd: s + span };
}

/** True when the window covers the whole trace (within a hair) — drives the "Full" affordance. */
export function isFullRange(win, tMin, tMax) {
  if (!win) return true;
  const eps = Math.max(1e-6, (tMax - tMin) * 1e-4);
  return win.tStart <= tMin + eps && win.tEnd >= tMax - eps;
}

/** Index of the last sample at or before `t`, assuming `time` ascends. */
function lowerBound(time, n, t) {
  let lo = 0;
  let hi = n - 1;
  if (t <= time[0]) return 0;
  if (t >= time[hi]) return hi;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (time[mid] <= t) lo = mid; else hi = mid;
  }
  return lo;
}

/**
 * Sample indices to draw for the span [tStart, tEnd], at most `maxPoints` of them.
 *
 * ⚠ The stride is computed from the count of samples INSIDE the window, which is the whole point.
 * The pre-60-02 chart decimated the full trace to 400 points first and then filtered, so a 2 s
 * window of a 47 s trace survived as ~17 points. Here it keeps the full budget.
 *
 * Null/NaN velocities are skipped; the last in-window sample is always included so the line
 * reaches the right edge instead of stopping short of it.
 */
export function resampleWindow(time, velocity, tStart, tEnd, maxPoints = 400) {
  const out = [];
  if (!time || !velocity || time.length === 0) return out;
  const n = Math.min(time.length, velocity.length);
  if (n === 0) return out;

  const lo = lowerBound(time, n, tStart);
  let hi = lowerBound(time, n, tEnd);
  if (time[hi] < tEnd && hi < n - 1) hi += 1;   // include the sample straddling the right edge
  if (hi < lo) return out;

  const count = hi - lo + 1;
  const stride = Math.max(1, Math.ceil(count / Math.max(1, maxPoints)));

  const ok = (i) => velocity[i] != null && !isNaN(velocity[i]);

  // ⚠ The lattice is anchored to ABSOLUTE index 0, not to `lo`. Anchoring it to `lo` makes the
  // sampled set slide with the window, so on a rolling window consecutive frames draw DIFFERENT
  // neighbouring samples and the polyline shimmers against itself. Measured at span 5 s: two
  // lattice phases alternating frame to frame. With a fixed lattice the window slide only adds and
  // removes points at the edges, and the interior is pixel-stable.
  const first = Math.ceil(lo / stride) * stride;
  for (let i = first; i <= hi; i += stride) if (ok(i)) out.push(i);

  // Reach the right edge only when nothing is being skipped anyway. At stride > 1 this vertex
  // would move every frame — the exact jitter the lattice exists to remove — and the gap it closes
  // is at most one stride, which is sub-pixel.
  if (stride === 1 && out.length > 0 && out[out.length - 1] !== hi && ok(hi)) out.push(hi);
  return out;
}

/** Time → x pixel, matching the chart's own projection. */
export function timeToPx(t, tMin, tMax, width, pad) {
  const span = tMax - tMin;
  const inner = width - pad * 2;
  if (!isFinite(span) || span <= 0 || inner <= 0) return pad;
  return pad + ((t - tMin) / span) * inner;
}

/** x pixel → time. Inverse of timeToPx. */
export function pxToTime(px, tMin, tMax, width, pad) {
  const span = tMax - tMin;
  const inner = width - pad * 2;
  if (!isFinite(span) || span <= 0 || inner <= 0) return tMin;
  return tMin + ((px - pad) / inner) * span;
}
