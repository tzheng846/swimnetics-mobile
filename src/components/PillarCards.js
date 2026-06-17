import React, { useEffect, useState } from 'react';
import {
  View, Text, TouchableOpacity, ActivityIndicator, StyleSheet,
} from 'react-native';
import { API_BASE } from '../config';

// Glanceable good/ok/needs-work read for the four headline pillars — RN mirror of the
// web PillarCards. Reads GET /sessions/{id}/ratings (ratings.py is the shared source of
// truth); colors come from the payload, never hard-coded. See RATINGS-SPEC.md.

const VERDICT = { good: 'Good', ok: 'OK', needs_work: 'Needs work' };
const TREND = {
  improved: { label: 'Improved', icon: '↑' },
  declined: { label: 'Declined', icon: '↓' },
  steady: { label: 'Steady', icon: '→' },
  first_session: { label: 'First session', icon: '•' },
};

function fmt(v) {
  if (v == null) return '--';
  if (typeof v === 'number') return Number.isInteger(v) ? String(v) : v.toFixed(2);
  return String(v);
}

function TrendChip({ trend, colors }) {
  const t = TREND[trend] || TREND.first_session;
  const fg =
    trend === 'improved' ? colors.good : trend === 'declined' ? colors.needs_work : '#888';
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

function PillarCard({ p, colors }) {
  const [open, setOpen] = useState(false);
  const unknown = p.band === 'unknown';
  const verdictColor =
    p.band === 'good' ? colors.good : p.band === 'ok' ? colors.ok : colors.needs_work;
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
              <Text style={[pc.verdict, { color: verdictColor }]}>{VERDICT[p.band]}</Text>
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
              {detail.map((m) => (
                <View key={m.key} style={pc.metricCell}>
                  <Text style={pc.metricLabel}>{m.label}</Text>
                  <Text style={pc.metricValue}>
                    {fmt(m.value)}
                    {m.unit ? <Text style={pc.metricUnit}> {m.unit}</Text> : null}
                  </Text>
                </View>
              ))}
            </View>
          )}
        </View>
      )}
    </View>
  );
}

export default function PillarCards({ sessionId, token }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(false);

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
        <ActivityIndicator color="#2196F3" />
      </View>
    );
  }

  const provisional = data.pillars.some((p) => p.provisional);

  return (
    <View>
      {provisional && (
        <Text style={pc.provisional}>⚠ Provisional — stroke segmentation is still being validated.</Text>
      )}
      {data.pillars.map((p) => (
        <PillarCard key={p.key} p={p} colors={data.rating_colors} />
      ))}
    </View>
  );
}

const pc = StyleSheet.create({
  card:        { backgroundColor: '#1a1a1a', borderRadius: 12, padding: 14, marginBottom: 10 },
  cardHead:    { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  pillarLabel: { fontSize: 15, fontWeight: '700', color: '#fff' },
  chip:        { backgroundColor: '#252525', borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 },
  chipText:    { fontSize: 12, fontWeight: '600' },
  bandWrap:    { height: 10, marginVertical: 12, position: 'relative' },
  bandRow:     { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, flexDirection: 'row', gap: 3 },
  seg:         { flex: 1 },
  segL:        { borderTopLeftRadius: 4, borderBottomLeftRadius: 4 },
  segR:        { borderTopRightRadius: 4, borderBottomRightRadius: 4 },
  marker:      { position: 'absolute', top: -4, width: 3, height: 18, borderRadius: 2, backgroundColor: '#fff', transform: [{ translateX: -1.5 }] },
  verdictRow:  { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  verdict:     { fontSize: 14, fontWeight: '700' },
  caret:       { fontSize: 11, color: '#555' },
  notEnough:   { fontSize: 13, color: '#888', marginTop: 8 },
  detail:      { marginTop: 12, borderTopWidth: 1, borderTopColor: '#2a2a2a', paddingTop: 12 },
  explanation: { fontSize: 13, color: '#aaa', lineHeight: 19 },
  metricGrid:  { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', marginTop: 12 },
  metricCell:  { width: '48%', backgroundColor: '#252525', borderRadius: 8, padding: 10, marginBottom: 8 },
  metricLabel: { fontSize: 11, color: '#888' },
  metricValue: { fontSize: 18, fontWeight: '700', color: '#fff', marginTop: 2 },
  metricUnit:  { fontSize: 11, color: '#888', fontWeight: '400' },
  stateCard:   { backgroundColor: '#1a1a1a', borderRadius: 12, padding: 20, marginBottom: 10, alignItems: 'center' },
  stateText:   { fontSize: 13, color: '#888' },
  provisional: { fontSize: 12, color: '#E67E22', marginBottom: 10 },
});
