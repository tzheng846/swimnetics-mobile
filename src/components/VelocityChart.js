import React from 'react';
import { Dimensions, Text, View, PanResponder, TouchableOpacity, StyleSheet } from 'react-native';
import Svg, { Polyline, Line, Text as SvgText, Rect } from 'react-native-svg';
import { colors } from '../theme';
import {
  clampWindow, fullRange, isFullRange, pxToTime, resampleWindow, timeToPx,
} from '../lib/chartWindow';

// Theme-aware colors: `dark` for the immersive active-recording screen, light for ReportCard.
const CHART_COLORS = {
  light: { grid: colors.border, line: colors.primary, marker: colors.periwinkle, cursor: colors.primary, tooltipBg: colors.text, tooltipText: colors.white, axis: colors.textMuted, cycle: colors.periwinkle, brushBg: colors.surfaceAlt, brushLine: colors.textMuted, brushMask: 'rgba(155,139,166,0.28)', handle: colors.primary, start: colors.good },
  dark:  { grid: 'rgba(255,255,255,0.18)', line: colors.accent, marker: colors.accent, cursor: colors.accent, tooltipBg: colors.surface, tooltipText: colors.text, axis: 'rgba(255,255,255,0.6)', cycle: 'rgba(255,255,255,0.35)', brushBg: 'rgba(255,255,255,0.06)', brushLine: 'rgba(255,255,255,0.45)', brushMask: 'rgba(0,0,0,0.42)', handle: colors.accent, start: '#7ee2a8' },
};

const MAX_POINTS = 400;
const BRUSH_H    = 30;
const BRUSH_PAD  = 4;
const HANDLE_W   = 8;
const HANDLE_HIT = 20;   // 8pt handles are not thumb-reachable; hit-test wider than we draw

// Phase 60 D6/D7. Pinch-to-zoom was REMOVED here — the window is now driven either by the brush
// strip below the chart (report card, record results) or by a controlled `window` prop (60-03's
// playhead-following video window). One primitive, two drivers.
//
// ⚠ Removing pinch also deleted a double-tap-to-reset that never worked:
// `onStartShouldSetPanResponder: () => false` meant a plain tap never granted the responder, so it
// only fired if the user dragged twice. That was a bug, not a feature.
export default function VelocityChart({
  time,
  velocity,
  markerTimeS = null,
  markerLabel = '',
  unitFactor = 1,
  unitLabel = 'm/s',
  interactive = false,
  dark = false,
  cycleBoundaries = [],
  onInteractionStart = null,
  onInteractionEnd = null,
  // Controlled window. Non-null wins over the brush; null leaves the chart uncontrolled.
  window: windowProp = null,
  // Render the draggable window strip below the chart.
  brush = false,
  onWindowChange = null,
  // Fires with the scrub cursor's time on every drag. The parent keeps its own copy, which
  // deliberately OUTLIVES the cursor's 2-second visual fade — otherwise a "use where I scrubbed to"
  // control would go dead before the user could reach it.
  onCursorChange = null,
  // A user-dropped start marker, drawn distinctly from `markerTimeS` (which is computed).
  startMarkerTimeS = null,
}) {
  const C = dark ? CHART_COLORS.dark : CHART_COLORS.light;
  const W = Dimensions.get('window').width - 48;
  const H = 150;
  const PAD = 4;

  // All hooks at top level (before early returns)
  const [cursor, setCursor] = React.useState(null);
  const [brushWin, setBrushWin] = React.useState(null);   // uncontrolled window, driven by the strip
  const cursorTimerRef = React.useRef(null);
  const chartDataRef = React.useRef({ t: [], v: [], tMin: 0, tMax: 1, tRange: 1 });
  const traceRef = React.useRef({ tMin: 0, tMax: 1 });
  const activeWinRef = React.useRef(null);
  const brushDragRef = React.useRef(null);   // { mode, grabX, startWin } for the duration of a drag
  const handleTouchRef        = React.useRef(null);
  const brushTouchRef         = React.useRef(null);
  const onInteractionStartRef = React.useRef(onInteractionStart);
  const onInteractionEndRef   = React.useRef(onInteractionEnd);
  const onWindowChangeRef     = React.useRef(onWindowChange);
  const onCursorChangeRef     = React.useRef(onCursorChange);

  // Chart-body responder: single-finger drag shows the velocity cursor. That is its ONLY job now
  // that pinch and pan-when-zoomed are gone.
  const panResponder = React.useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => false,
      onMoveShouldSetPanResponder: (evt, g) => Math.abs(g.dx) > Math.abs(g.dy),
      // Same class of bug as the brush below, smaller blast radius. This only grants on a
      // horizontal-dominant move, so it never blocked a plain vertical scroll from starting — but
      // once granted, a vertical drift let the parent ScrollView take the responder and killed the
      // scrub cursor mid-read.
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: (evt) => {
        onInteractionStartRef.current?.();
        handleTouchRef.current?.(evt.nativeEvent.locationX);
      },
      onPanResponderMove: (evt) => {
        handleTouchRef.current?.(evt.nativeEvent.locationX);
      },
      onPanResponderRelease: () => {
        onInteractionEndRef.current?.();
        if (cursorTimerRef.current) clearTimeout(cursorTimerRef.current);
        cursorTimerRef.current = setTimeout(() => setCursor(null), 2000);
      },
      onPanResponderTerminate: () => {
        onInteractionEndRef.current?.();
      },
    })
  ).current;

  // Brush-strip responder: a SECOND responder, deliberately. The old bugs came from one responder
  // multiplexing pinch, pan and cursor; one responder per job is the fix.
  const brushResponder = React.useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      // The reported bug: RN defaults this to `true`, so the parent ScrollView's native recognizer
      // asked for the responder the moment the finger drifted off the 30pt strip and the brush
      // handed it over MID-DRAG — sideways scrubbing turned into page scroll. ReportCard's
      // `scrollEnabled=false` cannot be the guard (async React state, may not have landed
      // natively), and RecordScreen's results chart never sets it at all.
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: (evt) => {
        onInteractionStartRef.current?.();
        brushTouchRef.current?.('grant', evt.nativeEvent.locationX);
      },
      onPanResponderMove: (evt) => {
        brushTouchRef.current?.('move', evt.nativeEvent.locationX);
      },
      onPanResponderRelease: () => {
        onInteractionEndRef.current?.();
        brushDragRef.current = null;
      },
      onPanResponderTerminate: () => {
        onInteractionEndRef.current?.();
        brushDragRef.current = null;
      },
    })
  ).current;

  // Full-trace downsample, memoized. This component previously had NO useMemo at all and re-walked
  // the entire sample array on every render — fine at 1 render, wasteful at the 20 Hz the video
  // page will drive it at.
  //
  // ⚠ This deliberately keeps the ORIGINAL projection (Math.floor stride over the full length)
  // rather than routing through resampleWindow, whose Math.ceil stride would yield a different
  // point set. The unwindowed view is pinned byte-identical to pre-60-02 output. Unifying the two
  // would silently change the default chart everyone looks at; if that is ever wanted, it is its
  // own change with its own before/after comparison.
  const full = React.useMemo(() => {
    if (!time || time.length < 2 || !velocity) return null;
    const step = Math.max(1, Math.floor(time.length / MAX_POINTS));
    const idx = [];
    for (let i = 0; i < time.length; i += step) {
      if (velocity[i] != null && !isNaN(velocity[i])) idx.push(i);
    }
    if (idx.length < 2) return null;
    let vMin = Infinity;
    let vMax = -Infinity;
    for (let k = 0; k < idx.length; k++) {
      const v = velocity[idx[k]];
      if (v < vMin) vMin = v;
      if (v > vMax) vMax = v;
    }
    const range = fullRange(time);
    return { idx, tMin: time[idx[0]], tMax: time[idx[idx.length - 1]], vMin, vMax, range };
  }, [time, velocity]);

  const activeWindow = windowProp ?? brushWin;

  // What actually gets drawn.
  const draw = React.useMemo(() => {
    if (!full) return null;
    if (!activeWindow) {
      return { idx: full.idx, tMin: full.tMin, tMax: full.tMax, vMin: full.vMin, vMax: full.vMax };
    }
    const idx = resampleWindow(time, velocity, activeWindow.tStart, activeWindow.tEnd, MAX_POINTS);
    if (idx.length < 2) {
      // Window landed somewhere with no drawable samples — show the full trace rather than nothing.
      return { idx: full.idx, tMin: full.tMin, tMax: full.tMax, vMin: full.vMin, vMax: full.vMax };
    }
    return {
      idx,
      tMin: activeWindow.tStart,
      tMax: activeWindow.tEnd,
      // Y pinned to the FULL trace whenever a window is active. Scaling to the visible slice makes
      // the trace jitter vertically 20x/second under a rolling window.
      vMin: full.vMin,
      vMax: full.vMax,
    };
  }, [full, activeWindow, time, velocity]);

  // Update refs every render so the frozen PanResponder handlers see current values
  onInteractionStartRef.current = onInteractionStart;
  onInteractionEndRef.current   = onInteractionEnd;
  onWindowChangeRef.current     = onWindowChange;
  onCursorChangeRef.current     = onCursorChange;
  activeWinRef.current          = activeWindow;
  if (full) traceRef.current    = { tMin: full.range.tStart, tMax: full.range.tEnd };

  if (!draw) {
    return <Text style={{ color: C.axis, marginTop: 8 }}>No data</Text>;
  }

  const t = draw.idx.map(i => time[i]);
  const v = draw.idx.map(i => velocity[i]);
  const tMin = draw.tMin;
  const tMax = draw.tMax;
  const vMin = draw.vMin;
  const vMax = draw.vMax;
  const vRange = vMax - vMin || 1;
  const tRange = tMax - tMin || 1;

  chartDataRef.current = { t, v, tMin, tMax, tRange };

  const px = (val) => PAD + ((val - tMin) / tRange) * (W - PAD * 2);
  const py = (val) => H - PAD - ((val - vMin) / vRange) * (H - PAD * 2);

  const points = t.map((ti, i) => `${px(ti).toFixed(1)},${py(v[i]).toFixed(1)}`).join(' ');
  const zeroY = py(0) < 0 ? -1 : py(0) > H ? H + 1 : py(0);

  const showMarker = markerTimeS != null && markerTimeS >= tMin && markerTimeS <= tMax;
  const markerX = showMarker ? px(markerTimeS) : null;

  const cursorX = cursor ? px(cursor.timeS) : null;
  const tooltipOnRight = cursorX != null && cursorX > W * 0.7;
  const tooltipX = tooltipOnRight ? cursorX - 76 : (cursorX ?? 0) + 4;

  // Cursor handler, rebuilt each render so it closes over current chart data via ref
  handleTouchRef.current = (touchX) => {
    const { t: ct, v: cv, tMin: ctMin, tRange: ctRange } = chartDataRef.current;
    if (!ct.length) return;
    const clampedX = Math.max(PAD, Math.min(W - PAD, touchX));
    if (cursorTimerRef.current) clearTimeout(cursorTimerRef.current);
    const timeAtTouch = ctMin + ((clampedX - PAD) / (W - PAD * 2)) * ctRange;
    const nearestIdx = ct.reduce(
      (best, ti, i) => (Math.abs(ti - timeAtTouch) < Math.abs(ct[best] - timeAtTouch) ? i : best),
      0,
    );
    setCursor({ timeS: ct[nearestIdx], vel: cv[nearestIdx] });
    onCursorChangeRef.current?.(ct[nearestIdx]);
  };

  // Brush handler: hit-test once on grant, then resize or pan for the rest of the drag.
  brushTouchRef.current = (phase, x) => {
    const { tMin: fMin, tMax: fMax } = traceRef.current;
    const win = activeWinRef.current ?? { tStart: fMin, tEnd: fMax };

    if (phase === 'grant') {
      const xs = timeToPx(win.tStart, fMin, fMax, W, BRUSH_PAD);
      const xe = timeToPx(win.tEnd, fMin, fMax, W, BRUSH_PAD);
      const dl = Math.abs(x - xs);
      const dr = Math.abs(x - xe);
      let mode = 'body';
      if (dl <= HANDLE_HIT || dr <= HANDLE_HIT) mode = dl <= dr ? 'left' : 'right';
      brushDragRef.current = { mode, grabX: x, startWin: win };
      return;
    }

    const drag = brushDragRef.current;
    if (!drag) return;
    const dt = pxToTime(x, fMin, fMax, W, BRUSH_PAD) - pxToTime(drag.grabX, fMin, fMax, W, BRUSH_PAD);
    const s = drag.startWin;
    let next;
    if (drag.mode === 'left') {
      next = clampWindow({ tStart: s.tStart + dt, tEnd: s.tEnd }, fMin, fMax, 'end');
    } else if (drag.mode === 'right') {
      next = clampWindow({ tStart: s.tStart, tEnd: s.tEnd + dt }, fMin, fMax, 'start');
    } else {
      next = clampWindow({ tStart: s.tStart + dt, tEnd: s.tEnd + dt }, fMin, fMax, 'span');
    }
    setBrushWin(next);
    onWindowChangeRef.current?.(next);
  };

  const svgContent = (
    <Svg width={W} height={H + 20}>
      <Line x1={PAD} y1={zeroY} x2={W - PAD} y2={zeroY} stroke={C.grid} strokeWidth={1} />
      {cycleBoundaries.map((bt, i) =>
        bt < tMin || bt > tMax ? null : (
          <Line
            key={`cyc-${i}`}
            x1={px(bt)}
            y1={PAD}
            x2={px(bt)}
            y2={H}
            stroke={C.cycle}
            strokeWidth={1}
            strokeDasharray="3,3"
            opacity={0.55}
          />
        ),
      )}
      <Polyline points={points} fill="none" stroke={C.line} strokeWidth={1.5} />
      {startMarkerTimeS != null && startMarkerTimeS >= tMin && startMarkerTimeS <= tMax && (
        <>
          <Line
            x1={px(startMarkerTimeS)} y1={0} x2={px(startMarkerTimeS)} y2={H}
            stroke={C.start} strokeWidth={2}
          />
          <SvgText x={px(startMarkerTimeS) + 3} y={H - 2} fontSize={9} fontWeight="bold" fill={C.start}>
            START
          </SvgText>
        </>
      )}
      {showMarker && (
        <>
          <Line x1={markerX} y1={0} x2={markerX} y2={H} stroke={C.marker} strokeWidth={1.5} />
          <SvgText x={markerX + 3} y={10} fontSize={9} fill={C.marker}>{markerLabel}</SvgText>
        </>
      )}
      {cursor && (
        <>
          <Line x1={cursorX} y1={0} x2={cursorX} y2={H} stroke={C.cursor} strokeWidth={1} opacity={0.7} />
          <Rect x={tooltipX} y={H / 2 - 18} width={72} height={30} rx={4} fill={C.tooltipBg} opacity={0.92} />
          <SvgText x={tooltipX + 4} y={H / 2 - 4} fontSize={10} fill={C.tooltipText}>
            {(cursor.vel * unitFactor).toFixed(2)} {unitLabel}
          </SvgText>
          <SvgText x={tooltipX + 4} y={H / 2 + 10} fontSize={10} fill={C.axis}>
            {cursor.timeS.toFixed(1)}s
          </SvgText>
        </>
      )}
      <SvgText x={PAD} y={H + 14} fontSize={10} fill={C.axis}>{tMin.toFixed(0)}s</SvgText>
      <SvgText x={W - 24} y={H + 14} fontSize={10} fill={C.axis}>{tMax.toFixed(0)}s</SvgText>
      <SvgText x={PAD} y={12} fontSize={10} fill={C.axis}>{(vMax * unitFactor).toFixed(1)} {unitLabel}</SvgText>
    </Svg>
  );

  // ── Brush strip ──────────────────────────────────────────────────────────────
  let brushContent = null;
  if (brush && full) {
    const fMin = full.range.tStart;
    const fMax = full.range.tEnd;
    const win = activeWindow ?? { tStart: fMin, tEnd: fMax };
    const bx = (val) => timeToPx(val, fMin, fMax, W, BRUSH_PAD);
    const by = (val) => BRUSH_H - 3 - ((val - full.vMin) / (full.vMax - full.vMin || 1)) * (BRUSH_H - 6);
    const miniPoints = full.idx
      .map(i => `${bx(time[i]).toFixed(1)},${by(velocity[i]).toFixed(1)}`)
      .join(' ');
    const xs = bx(win.tStart);
    const xe = bx(win.tEnd);

    brushContent = (
      <View {...brushResponder.panHandlers} style={{ marginTop: 2 }}>
        <Svg width={W} height={BRUSH_H}>
          <Rect x={0} y={0} width={W} height={BRUSH_H} rx={4} fill={C.brushBg} />
          <Polyline points={miniPoints} fill="none" stroke={C.brushLine} strokeWidth={1} />
          {/* dim everything outside the window */}
          <Rect x={0} y={0} width={Math.max(0, xs)} height={BRUSH_H} fill={C.brushMask} />
          <Rect x={xe} y={0} width={Math.max(0, W - xe)} height={BRUSH_H} fill={C.brushMask} />
          {/* handles */}
          <Rect x={xs - HANDLE_W / 2} y={0} width={HANDLE_W} height={BRUSH_H} rx={2} fill={C.handle} opacity={0.9} />
          <Rect x={xe - HANDLE_W / 2} y={0} width={HANDLE_W} height={BRUSH_H} rx={2} fill={C.handle} opacity={0.9} />
        </Svg>
      </View>
    );
  }

  const showFullBtn = brush && full && activeWindow && !isFullRange(activeWindow, full.range.tStart, full.range.tEnd);

  return (
    <View>
      {interactive ? (
        <View {...panResponder.panHandlers}>{svgContent}</View>
      ) : (
        svgContent
      )}
      {brushContent}
      {showFullBtn && (
        <TouchableOpacity onPress={() => { setBrushWin(null); onWindowChangeRef.current?.(null); }} style={vcStyles.resetZoom}>
          <Text style={vcStyles.resetZoomText}>Full</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

const vcStyles = StyleSheet.create({
  resetZoom: { alignSelf: 'center', marginTop: 4, paddingHorizontal: 12, paddingVertical: 4, backgroundColor: colors.surfaceAlt, borderRadius: 10 },
  resetZoomText: { fontSize: 11, color: colors.textSecondary },
});
