import React from 'react';
import { Dimensions, View, Text, StyleSheet } from 'react-native';
import Svg, { Polyline, Line, Circle, Text as SvgText } from 'react-native-svg';
import { colors } from '../theme';

// Per-cycle trends — the shape of a swim, not six averages of it. Mirrors the web portal's
// CycleCharts (web/components/portal/CycleCharts.js), hand-rolled in react-native-svg because
// there is no chart library on mobile (recharts is web-only; react-native-svg is all we have).
//
// ⚠ ALL cycles are plotted, undifferentiated (Phase 60 D8). Every session mean/CV is computed
// over STEADY cycles only (metrics.py:892), so two mismatches are EXPECTED and deliberate:
//   1. there are more dots here than session.stroke_count, which IS the steady count (metrics.py:906)
//   2. the dashed mean line does not sit at the visual average of the dots
// Do not "fix" these by filtering, hiding or renumbering cycles — that was offered to the user
// and declined.

const CHART_H = 120;
const PAD_L = 34;   // room for y-axis labels
const PAD_R = 8;
const PAD_T = 10;
const PAD_B = 16;   // room for x-axis labels

function TrendPanel({ title, caption, values, unit, refValue, decimals = 2 }) {
  const W = Dimensions.get('window').width - 68;  // screen − screen padding (40) − card padding (28)

  const pts = values
    .map((v, i) => ({ n: i + 1, v }))
    .filter(p => p.v != null && !isNaN(p.v));

  if (pts.length === 0) {
    return (
      <View style={s.panel}>
        <Text style={s.panelTitle}>{title}</Text>
        <Text style={s.empty}>No cycle data</Text>
      </View>
    );
  }

  // Y range spans the data AND the reference line, so the mean is always visible.
  const candidates = pts.map(p => p.v);
  if (refValue != null && !isNaN(refValue)) candidates.push(refValue);
  let vMin = Math.min(...candidates);
  let vMax = Math.max(...candidates);
  if (vMax - vMin < 1e-9) { vMin -= 0.5; vMax += 0.5; }   // flat series → don't divide by zero
  const pad = (vMax - vMin) * 0.12;
  vMin -= pad;
  vMax += pad;

  const nMax = Math.max(pts[pts.length - 1].n, 2);
  const px = (n) => PAD_L + ((n - 1) / (nMax - 1)) * (W - PAD_L - PAD_R);
  const py = (v) => PAD_T + (1 - (v - vMin) / (vMax - vMin)) * (CHART_H - PAD_T - PAD_B);

  const polyline = pts.map(p => `${px(p.n).toFixed(1)},${py(p.v).toFixed(1)}`).join(' ');
  const refY = refValue != null && !isNaN(refValue) ? py(refValue) : null;

  return (
    <View style={s.panel}>
      <Text style={s.panelTitle}>{title}</Text>
      <Svg width={W} height={CHART_H}>
        {/* y-axis extremes */}
        <SvgText x={0} y={PAD_T + 4} fontSize={9} fill={colors.textMuted}>
          {vMax.toFixed(decimals)}
        </SvgText>
        <SvgText x={0} y={CHART_H - PAD_B + 4} fontSize={9} fill={colors.textMuted}>
          {vMin.toFixed(decimals)}
        </SvgText>

        {/* mean reference */}
        {refY != null && (
          <>
            <Line
              x1={PAD_L} y1={refY} x2={W - PAD_R} y2={refY}
              stroke={colors.textMuted} strokeWidth={1} strokeDasharray="4,3" opacity={0.7}
            />
            <SvgText x={W - PAD_R - 26} y={refY - 3} fontSize={8} fill={colors.textMuted}>
              mean
            </SvgText>
          </>
        )}

        <Polyline points={polyline} fill="none" stroke={colors.primary} strokeWidth={1.6} />
        {pts.map(p => (
          <Circle key={p.n} cx={px(p.n)} cy={py(p.v)} r={2.5} fill={colors.primary} />
        ))}

        {/* x-axis: first and last cycle number */}
        <SvgText x={PAD_L} y={CHART_H - 2} fontSize={9} fill={colors.textMuted}>1</SvgText>
        <SvgText x={W - PAD_R - 12} y={CHART_H - 2} fontSize={9} fill={colors.textMuted}>
          {nMax}
        </SvgText>
      </Svg>
      <Text style={s.caption}>{caption}{unit ? ` ${unit}` : ''}</Text>
    </View>
  );
}

export default function CycleCharts({ cycles, session, unitFactor = 1, distUnit = 'm', velUnit = 'm/s' }) {
  const list = cycles ?? [];
  const ss = session ?? {};

  const fmt = (v, d = 2) => (v != null && !isNaN(v) ? v.toFixed(d) : '--');
  const pct = (v) => (v != null && !isNaN(v) ? `${(v * 100).toFixed(1)}%` : '--');

  return (
    <View>
      <TrendPanel
        title="Distance per Stroke"
        values={list.map(c => (c.dist_m != null ? c.dist_m * unitFactor : null))}
        refValue={ss.mean_dps_m != null ? ss.mean_dps_m * unitFactor : null}
        caption={`mean ${fmt(ss.mean_dps_m != null ? ss.mean_dps_m * unitFactor : null)} ${distUnit} ·`}
        unit="per cycle"
        decimals={2}
      />
      <TrendPanel
        title="Coast"
        values={list.map(c => (c.coast_fraction != null ? c.coast_fraction * 100 : null))}
        refValue={ss.mean_coast_fraction != null ? ss.mean_coast_fraction * 100 : null}
        caption={`mean ${pct(ss.mean_coast_fraction)} of each cycle below half its own arm-peak speed ·`}
        unit=""
        decimals={0}
      />
      <TrendPanel
        title="Cycle Duration (ISI)"
        values={list.map(c => c.duration_s ?? null)}
        refValue={ss.mean_isi_s ?? null}
        caption={`mean ${fmt(ss.mean_isi_s)} s · rhythm consistency (ISI CV) ${pct(ss.cv_isi)} ·`}
        unit=""
        decimals={2}
      />
      <TrendPanel
        title="Arm Peak Velocity"
        values={list.map(c => (c.arm_peak_vel != null ? c.arm_peak_vel * unitFactor : null))}
        refValue={ss.mean_arm_peak_vel_ms != null ? ss.mean_arm_peak_vel_ms * unitFactor : null}
        caption={`mean ${fmt(ss.mean_arm_peak_vel_ms != null ? ss.mean_arm_peak_vel_ms * unitFactor : null)} ${velUnit} · power consistency (CV) ${pct(ss.cv_arm_peak_vel)} ·`}
        unit=""
        decimals={2}
      />
      <Text style={s.footnote}>
        One point per detected cycle. Means and CVs are computed over steady-state cycles only, so
        the dashed line may not sit at the visual average.
      </Text>
    </View>
  );
}

const s = StyleSheet.create({
  panel:      { marginBottom: 14 },
  panelTitle: { fontSize: 11, color: colors.textSecondary, fontWeight: '600', letterSpacing: 0.5, textTransform: 'uppercase', marginBottom: 4 },
  caption:    { fontSize: 11, color: colors.textMuted, marginTop: 2, lineHeight: 15 },
  empty:      { fontSize: 12, color: colors.textMuted, fontStyle: 'italic', paddingVertical: 16, textAlign: 'center' },
  footnote:   { fontSize: 10, color: colors.textMuted, fontStyle: 'italic', lineHeight: 14, marginTop: 2 },
});
