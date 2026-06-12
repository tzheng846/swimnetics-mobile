import React from 'react';
import { Dimensions, Text, View, PanResponder, TouchableOpacity, StyleSheet } from 'react-native';
import Svg, { Polyline, Line, Text as SvgText, Rect } from 'react-native-svg';

export default function VelocityChart({
  time,
  velocity,
  markerTimeS = null,
  markerLabel = '',
  unitFactor = 1,
  unitLabel = 'm/s',
  interactive = false,
  onInteractionStart = null,
  onInteractionEnd = null,
}) {
  const W = Dimensions.get('window').width - 48;
  const H = 150;
  const PAD = 4;

  // All hooks at top level (before early returns)
  const [cursor, setCursor] = React.useState(null);
  const [zoomWindow, setZoomWindow] = React.useState(null);
  const cursorTimerRef = React.useRef(null);
  const pinchRef = React.useRef(null);
  const panRef = React.useRef(null); // { startX, startTStart, startTEnd } for scroll-when-zoomed
  const lastTapRef = React.useRef(0);
  const chartDataRef = React.useRef({ t: [], v: [], tMin: 0, tMax: 1, tRange: 1, fullT: [] });
  const zoomWindowRef = React.useRef(null);
  const handleTouchRef        = React.useRef(null);
  const onInteractionStartRef = React.useRef(onInteractionStart);
  const onInteractionEndRef   = React.useRef(onInteractionEnd);

  // PanResponder created once — calls handleTouchRef.current to avoid stale closures
  const panResponder = React.useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => false,
      onMoveShouldSetPanResponder: (evt, g) =>
        evt.nativeEvent.touches.length >= 2 || Math.abs(g.dx) > Math.abs(g.dy),
      onPanResponderGrant: (evt) => {
        onInteractionStartRef.current?.();
        handleTouchRef.current?.(evt.nativeEvent.locationX, evt.nativeEvent.touches);
      },
      onPanResponderMove: (evt) => {
        handleTouchRef.current?.(evt.nativeEvent.locationX, evt.nativeEvent.touches);
      },
      onPanResponderRelease: () => {
        onInteractionEndRef.current?.();
        pinchRef.current = null;
        panRef.current = null;
        const now = Date.now();
        if (now - lastTapRef.current < 300) {
          setZoomWindow(null);
          setCursor(null);
        }
        lastTapRef.current = now;
        if (cursorTimerRef.current) clearTimeout(cursorTimerRef.current);
        cursorTimerRef.current = setTimeout(() => setCursor(null), 2000);
      },
      onPanResponderTerminate: () => {
        onInteractionEndRef.current?.();
        pinchRef.current = null;
        panRef.current   = null;
      },
    })
  ).current;

  // Update refs every render so frozen PanResponder handlers see current values
  zoomWindowRef.current        = zoomWindow;
  onInteractionStartRef.current = onInteractionStart;
  onInteractionEndRef.current   = onInteractionEnd;

  if (!time || time.length < 2) {
    return <Text style={{ color: '#999', marginTop: 8 }}>No data</Text>;
  }

  // Downsample to max 400 points; filter null/NaN
  const step = Math.max(1, Math.floor(time.length / 400));
  const allIndices = [];
  for (let i = 0; i < time.length; i += step) {
    if (velocity[i] != null && !isNaN(velocity[i])) allIndices.push(i);
  }
  if (allIndices.length < 2) return <Text style={{ color: '#999', marginTop: 8 }}>No data</Text>;

  const fullT = allIndices.map(i => time[i]);
  const fullV = allIndices.map(i => velocity[i]);

  // Apply zoom window filter
  const zoomedIndices = zoomWindow
    ? allIndices.filter(i => time[i] >= zoomWindow.tStart && time[i] <= zoomWindow.tEnd)
    : allIndices;
  const useIndices = zoomedIndices.length >= 2 ? zoomedIndices : allIndices;
  const t = useIndices.map(i => time[i]);
  const v = useIndices.map(i => velocity[i]);

  const tMin = zoomWindow ? zoomWindow.tStart : t[0];
  const tMax = zoomWindow ? zoomWindow.tEnd : t[t.length - 1];
  const vMin = Math.min(...v);
  const vMax = Math.max(...v);
  const vRange = vMax - vMin || 1;
  const tRange = tMax - tMin || 1;

  // Keep chart data ref current for PanResponder handlers
  chartDataRef.current = { t, v, tMin, tMax, tRange, fullT };

  const px = (val) => PAD + ((val - tMin) / tRange) * (W - PAD * 2);
  const py = (val) => H - PAD - ((val - vMin) / vRange) * (H - PAD * 2);

  const points = t.map((ti, i) => `${px(ti).toFixed(1)},${py(v[i]).toFixed(1)}`).join(' ');
  const zeroY = py(0) < 0 ? -1 : py(0) > H ? H + 1 : py(0);

  const showMarker = markerTimeS != null && markerTimeS >= tMin && markerTimeS <= tMax;
  const markerX = showMarker ? px(markerTimeS) : null;

  const cursorX = cursor ? px(cursor.timeS) : null;
  const tooltipOnRight = cursorX != null && cursorX > W * 0.7;
  const tooltipX = tooltipOnRight ? cursorX - 76 : (cursorX ?? 0) + 4;

  // Update handleTouch each render so it closes over current chart data via ref
  handleTouchRef.current = (touchX, touches) => {
    const { t: ct, v: cv, tMin: ctMin, tRange: ctRange, fullT: cFullT } = chartDataRef.current;

    if (touches.length >= 2) {
      const getPinchDist = (ts) => Math.hypot(ts[0].pageX - ts[1].pageX, ts[0].pageY - ts[1].pageY);
      const dist = getPinchDist(touches);
      if (!pinchRef.current) {
        const fullRange = { tStart: cFullT[0], tEnd: cFullT[cFullT.length - 1] };
        pinchRef.current = { startDist: dist, startWindow: zoomWindowRef.current ?? fullRange };
      } else {
        const scale = pinchRef.current.startDist / dist;
        const { tStart, tEnd } = pinchRef.current.startWindow;
        const mid = (tStart + tEnd) / 2;
        const halfRange = ((tEnd - tStart) / 2) * Math.max(0.1, Math.min(1.0, scale));
        const newStart = Math.max(cFullT[0], mid - halfRange);
        const newEnd = Math.min(cFullT[cFullT.length - 1], mid + halfRange);
        if (newEnd - newStart > 0.5) {
          setZoomWindow({ tStart: newStart, tEnd: newEnd });
        }
      }
      return;
    }
    pinchRef.current = null;

    const clampedX = Math.max(PAD, Math.min(W - PAD, touchX));

    if (zoomWindowRef.current) {
      // Zoomed: single-finger drag pans the time window
      if (!panRef.current) {
        panRef.current = {
          startX: clampedX,
          startTStart: zoomWindowRef.current.tStart,
          startTEnd: zoomWindowRef.current.tEnd,
        };
      }
      const { startX, startTStart, startTEnd } = panRef.current;
      const windowWidth = startTEnd - startTStart;
      const timePerPixel = windowWidth / (W - PAD * 2);
      const deltaTime = (startX - clampedX) * timePerPixel;
      const rawStart = startTStart + deltaTime;
      const newStart = Math.max(cFullT[0], Math.min(cFullT[cFullT.length - 1] - windowWidth, rawStart));
      setZoomWindow({ tStart: newStart, tEnd: newStart + windowWidth });
    } else {
      // Not zoomed: show velocity cursor
      panRef.current = null;
      if (cursorTimerRef.current) clearTimeout(cursorTimerRef.current);
      const timeAtTouch = ctMin + ((clampedX - PAD) / (W - PAD * 2)) * ctRange;
      const nearestIdx = ct.reduce(
        (best, ti, i) => (Math.abs(ti - timeAtTouch) < Math.abs(ct[best] - timeAtTouch) ? i : best),
        0,
      );
      setCursor({ timeS: ct[nearestIdx], vel: cv[nearestIdx] });
    }
  };

  const svgContent = (
    <Svg width={W} height={H + 20}>
      <Line x1={PAD} y1={zeroY} x2={W - PAD} y2={zeroY} stroke="#E8E8E8" strokeWidth={1} />
      <Polyline points={points} fill="none" stroke="#1E3A5F" strokeWidth={1.5} />
      {showMarker && (
        <>
          <Line x1={markerX} y1={0} x2={markerX} y2={H} stroke="#E67E22" strokeWidth={1.5} />
          <SvgText x={markerX + 3} y={10} fontSize={9} fill="#E67E22">{markerLabel}</SvgText>
        </>
      )}
      {cursor && (
        <>
          <Line x1={cursorX} y1={0} x2={cursorX} y2={H} stroke="#2196F3" strokeWidth={1} opacity={0.7} />
          <Rect x={tooltipX} y={H / 2 - 18} width={72} height={30} rx={4} fill="#1E3A5F" opacity={0.85} />
          <SvgText x={tooltipX + 4} y={H / 2 - 4} fontSize={10} fill="#FFF">
            {(cursor.vel * unitFactor).toFixed(2)} {unitLabel}
          </SvgText>
          <SvgText x={tooltipX + 4} y={H / 2 + 10} fontSize={10} fill="#AAA">
            {cursor.timeS.toFixed(1)}s
          </SvgText>
        </>
      )}
      <SvgText x={PAD} y={H + 14} fontSize={10} fill="#AAA">{tMin.toFixed(0)}s</SvgText>
      <SvgText x={W - 24} y={H + 14} fontSize={10} fill="#AAA">{tMax.toFixed(0)}s</SvgText>
      <SvgText x={PAD} y={12} fontSize={10} fill="#AAA">{(vMax * unitFactor).toFixed(1)} {unitLabel}</SvgText>
    </Svg>
  );

  return (
    <View>
      {interactive ? (
        <View {...panResponder.panHandlers}>{svgContent}</View>
      ) : (
        svgContent
      )}
      {interactive && zoomWindow && (
        <TouchableOpacity onPress={() => setZoomWindow(null)} style={vcStyles.resetZoom}>
          <Text style={vcStyles.resetZoomText}>Reset zoom</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

const vcStyles = StyleSheet.create({
  resetZoom: { alignSelf: 'center', marginTop: 4, paddingHorizontal: 10, paddingVertical: 3, backgroundColor: '#F0F2F5', borderRadius: 10 },
  resetZoomText: { fontSize: 11, color: '#7F8C8D' },
});
