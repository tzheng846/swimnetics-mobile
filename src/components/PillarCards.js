import React, { useEffect, useState } from 'react';
import {
  View, Text, TouchableOpacity, Pressable, Modal, ActivityIndicator, StyleSheet,
} from 'react-native';
import { API_BASE } from '../config';
import { BAND_LABEL, PROVISIONAL_NOTE, bandColor } from '../lib/indicators';
import { colors as ui } from '../theme';

// Glanceable good/ok/needs-work read for the four headline pillars — RN mirror of the
// web PillarCards. Reads GET /sessions/{id}/ratings (ratings.py is the shared source of
// truth); the band label and color come from lib/indicators, which reads the payload
// (never hard-coded). See RATINGS-SPEC.md.

// Trend is vs the athlete's PREVIOUS session — labelled explicitly so a "down vs last" chip
// reads clearly alongside a still-good (green) band (they measure different things).
const TREND = {
  improved: { label: 'Up vs last', icon: '↑' },
  declined: { label: 'Down vs last', icon: '↓' },
  steady: { label: 'Same as last', icon: '→' },
  first_session: { label: 'First session', icon: '•' },
};

function fmt(v) {
  if (v == null) return '--';
  if (typeof v === 'number') return Number.isInteger(v) ? String(v) : v.toFixed(2);
  return String(v);
}

const M_TO_YD = 1.09361;
// Convert a metric's value+unit for the active distance unit. Only distance ("m") and
// velocity ("m/s") convert; rates (spm), %, s, and unitless pass through unchanged.
function displayMetric(value, unit, pref) {
  if (pref === 'imperial' && typeof value === 'number') {
    if (unit === 'm') return { value: value * M_TO_YD, unit: 'yd' };
    if (unit === 'm/s') return { value: value * M_TO_YD, unit: 'yd/s' };
  }
  return { value, unit };
}

function TrendChip({ trend, colors }) {
  const t = TREND[trend] || TREND.first_session;
  const fg =
    trend === 'improved' ? colors.good : trend === 'declined' ? colors.needs_work : ui.textMuted;
  return (
    <View style={pc.chip}>
      <Text style={[pc.chipText, { color: fg }]}>{t.icon} {t.label}</Text>
    </View>
  );
}

function Band({ score, colors }) {
  const pos = Math.max(0, Math.min(100, score ?? 0));
  return (
    <View style={pc.bandWrap}>
      <View style={pc.bandRow}>
        <View style={[pc.seg, pc.segL, { backgroundColor: colors.needs_work }]} />
        <View style={[pc.seg, { backgroundColor: colors.ok }]} />
        <View style={[pc.seg, pc.segR, { backgroundColor: colors.good }]} />
      </View>
      <View style={[pc.marker, { left: `${pos}%` }]} />
    </View>
  );
}

function PillarCard({ p, colors, unit, onExplain }) {
  const [open, setOpen] = useState(false);
  const unknown = p.band === 'unknown';
  const detail = [p.primary, ...(p.metrics || [])].filter((m) => m && m.value != null);

  return (
    <View style={pc.card}>
      <TouchableOpacity activeOpacity={0.7} onPress={() => setOpen((o) => !o)}>
        <View style={pc.cardHead}>
          <Text style={pc.pillarLabel}>{p.label}</Text>
          <TrendChip trend={p.trend} colors={colors} />
        </View>

        {unknown ? (
          <Text style={pc.notEnough}>Not enough data</Text>
        ) : (
          <>
            <Band score={p.score} colors={colors} />
            <View style={pc.verdictRow}>
              <Text style={[pc.verdict, { color: bandColor(p.band, colors) }]}>{BAND_LABEL[p.band]}</Text>
              <Text style={pc.caret}>{open ? '▲' : '▼'}</Text>
            </View>
          </>
        )}
      </TouchableOpacity>

      {open && (
        <View style={pc.detail}>
          <Text style={pc.explanation}>{p.explanation}</Text>
          {detail.length > 0 && (
            <View style={pc.metricGrid}>
              {detail.map((m) => {
                const d = displayMetric(m.value, m.unit, unit);
                return (
                  <Pressable
                    key={m.key}
                    style={pc.metricCell}
                    delayLongPress={250}
                    onLongPress={() => onExplain?.({ label: m.label, explanation: m.explanation || p.explanation, unit: d.unit })}
                    accessibilityHint="Hold to see what this means"
                  >
                    <Text style={pc.metricLabel}>{m.label}</Text>
                    <Text style={pc.metricValue}>
                      {fmt(d.value)}
                      {d.unit ? <Text style={pc.metricUnit}> {d.unit}</Text> : null}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          )}
        </View>
      )}
    </View>
  );
}

export default function PillarCards({ sessionId, token, unit = 'metric' }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(false);
  const [explain, setExplain] = useState(null); // { label, explanation, unit } | null

  useEffect(() => {
    let live = true;
    setData(null);
    setError(false);
    (async () => {
      try {
        const res = await fetch(`${API_BASE}/sessions/${sessionId}/ratings`, {
          headers: token ? { Authorization: `Bearer ${token}` } : undefined,
        });
        if (!res.ok) throw new Error(`status ${res.status}`);
        const json = await res.json();
        if (live) setData(json);
      } catch {
        if (live) setError(true);
      }
    })();
    return () => { live = false; };
  }, [sessionId, token]);

  if (error) {
    return (
      <View style={pc.stateCard}>
        <Text style={pc.stateText}>Couldn’t load the rating summary.</Text>
      </View>
    );
  }
  if (!data) {
    return (
      <View style={pc.stateCard}>
        <ActivityIndicator color={ui.primary} />
      </View>
    );
  }

  const provisional = data.pillars.some((p) => p.provisional);

  return (
    <View>
      {provisional && (
        <Text style={pc.provisional}>{PROVISIONAL_NOTE}</Text>
      )}
      {data.pillars.map((p) => (
        <PillarCard key={p.key} p={p} colors={data.rating_colors} unit={unit} onExplain={setExplain} />
      ))}

      <Modal visible={!!explain} transparent animationType="fade" onRequestClose={() => setExplain(null)}>
        <Pressable style={pc.scrim} onPress={() => setExplain(null)}>
          <Pressable style={pc.explainCard} onPress={() => {}}>
            <Text style={pc.explainTitle}>{explain?.label}</Text>
            <Text style={pc.explainBody}>{explain?.explanation}</Text>
            <Text style={pc.explainUnit}>{explain?.unit ? `Measured in ${explain.unit}` : 'Unitless ratio'}</Text>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

const pc = StyleSheet.create({
  card:        { backgroundColor: ui.surface, borderWidth: 1, borderColor: ui.border, borderRadius: 12, padding: 14, marginBottom: 10 },
  cardHead:    { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  pillarLabel: { fontSize: 15, fontWeight: '700', color: ui.text },
  chip:        { backgroundColor: ui.surfaceAlt, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 },
  chipText:    { fontSize: 12, fontWeight: '600' },
  bandWrap:    { height: 10, marginVertical: 12, position: 'relative' },
  bandRow:     { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, flexDirection: 'row', gap: 3 },
  seg:         { flex: 1 },
  segL:        { borderTopLeftRadius: 4, borderBottomLeftRadius: 4 },
  segR:        { borderTopRightRadius: 4, borderBottomRightRadius: 4 },
  marker:      { position: 'absolute', top: -4, width: 3, height: 18, borderRadius: 2, backgroundColor: ui.text, transform: [{ translateX: -1.5 }] },
  verdictRow:  { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  verdict:     { fontSize: 14, fontWeight: '700' },
  caret:       { fontSize: 11, color: ui.textMuted },
  notEnough:   { fontSize: 13, color: ui.textSecondary, marginTop: 8 },
  detail:      { marginTop: 12, borderTopWidth: 1, borderTopColor: ui.border, paddingTop: 12 },
  explanation: { fontSize: 13, color: ui.textSecondary, lineHeight: 19 },
  metricGrid:  { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', marginTop: 12 },
  metricCell:  { width: '48%', backgroundColor: ui.surfaceAlt, borderRadius: 8, padding: 10, marginBottom: 8 },
  metricLabel: { fontSize: 11, color: ui.textSecondary },
  metricValue: { fontSize: 18, fontWeight: '700', color: ui.text, marginTop: 2 },
  metricUnit:  { fontSize: 11, color: ui.textMuted, fontWeight: '400' },
  stateCard:   { backgroundColor: ui.surface, borderWidth: 1, borderColor: ui.border, borderRadius: 12, padding: 20, marginBottom: 10, alignItems: 'center' },
  stateText:   { fontSize: 13, color: ui.textSecondary },
  provisional: { fontSize: 12, color: ui.ok, marginBottom: 10 },
  scrim:       { flex: 1, backgroundColor: ui.scrim, alignItems: 'center', justifyContent: 'center', padding: 28 },
  explainCard: { backgroundColor: ui.surface, borderRadius: 14, padding: 18, maxWidth: 360, width: '100%' },
  explainTitle:{ fontSize: 16, fontWeight: '700', color: ui.text },
  explainBody: { fontSize: 14, color: ui.textSecondary, lineHeight: 20, marginTop: 8 },
  explainUnit: { fontSize: 12, color: ui.textMuted, marginTop: 10 },
});
