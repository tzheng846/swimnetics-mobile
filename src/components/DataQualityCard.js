import React from 'react';
import { View, Text, StyleSheet } from 'react-native';

/**
 * DataQualityCard — shows cycle quality stats and warnings from the
 * data_quality object returned by POST /process (or stored in metrics_json).
 *
 * Props:
 *   dataQuality: {
 *     magnet_dropout_pct: number,
 *     outlier_cycle_count: number,
 *     implausible_cycle_count: number,
 *     total_cycles_raw: number,
 *     warnings: string[],
 *   } | null | undefined
 */
export default function DataQualityCard({ dataQuality }) {
  if (!dataQuality) return null;

  const {
    warnings = [],
    total_cycles_raw = 0,
    outlier_cycle_count = 0,
    implausible_cycle_count = 0,
    magnet_dropout_pct = 0,
  } = dataQuality;

  // Kick warning is always present — show as a muted note, not an amber alert
  const kickWarning = warnings.find(w => w.toLowerCase().includes('kick'));
  const sessionWarnings = warnings.filter(w => !w.toLowerCase().includes('kick'));
  const hasIssues = sessionWarnings.length > 0;

  return (
    <View style={[s.card, hasIssues && s.cardWarn]}>
      <Text style={s.title}>Data Quality</Text>

      <View style={s.statsRow}>
        <Stat label="Cycles"      value={String(total_cycles_raw)} />
        <Stat label="Outliers"    value={String(outlier_cycle_count)}     warn={outlier_cycle_count > 0} />
        <Stat label="Implausible" value={String(implausible_cycle_count)} warn={implausible_cycle_count > 0} />
        <Stat
          label="Dropout"
          value={magnet_dropout_pct > 0 ? `${magnet_dropout_pct.toFixed(1)}%` : '0%'}
          warn={magnet_dropout_pct > 5}
        />
      </View>

      {sessionWarnings.map((w, i) => (
        <View key={i} style={s.warnRow}>
          <Text style={s.warnText}>⚠ {w}</Text>
        </View>
      ))}

      {kickWarning ? (
        <Text style={s.kickNote}>{kickWarning}</Text>
      ) : null}
    </View>
  );
}

function Stat({ label, value, warn }) {
  return (
    <View style={s.stat}>
      <Text style={s.statLabel}>{label}</Text>
      <Text style={[s.statValue, warn && s.statWarn]}>{value}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  card:       { backgroundColor: '#FFF', borderRadius: 12, padding: 14, marginBottom: 10 },
  cardWarn:   { borderLeftWidth: 3, borderLeftColor: '#F39C12' },
  title:      { fontSize: 11, color: '#7F8C8D', fontWeight: '600', letterSpacing: 1, textTransform: 'uppercase', marginBottom: 10 },
  statsRow:   { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 8 },
  stat:       { alignItems: 'center', flex: 1 },
  statLabel:  { fontSize: 11, color: '#7F8C8D', textTransform: 'uppercase', letterSpacing: 0.5 },
  statValue:  { fontSize: 18, fontWeight: '700', color: '#1E3A5F', marginTop: 2 },
  statWarn:   { color: '#E67E22' },
  warnRow:    { backgroundColor: '#FFF9E6', borderRadius: 6, padding: 8, marginBottom: 4 },
  warnText:   { fontSize: 12, color: '#E67E22', lineHeight: 17 },
  kickNote:   { fontSize: 11, color: '#B0B8C4', marginTop: 4, lineHeight: 16 },
});
