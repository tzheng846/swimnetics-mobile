// Phase 60 D9 — the one thing that survives the Data Quality card.
//
// Dropout is the only stat on that card that never touched the segmenter: api.py:150-160 counts
// `magnet_ok == 0` rows straight out of the raw CSV, i.e. samples where the AS5600 failed its I2C
// read (magnet misaligned, wheel wobbling, connector loose). It is hardware truth, and the visible
// product of a real firmware fix — angle == 4095 used to pass through as valid data until
// readAngle() began error-checking and flagging magnet_ok = 0.
//
// The card's other three stats (total_cycles_raw / outlier_cycle_count / implausible_cycle_count)
// are segmentation-derived, and Phase 59 replaced the segmenter for every stroke. The implausible
// rails are also hardcoded 0.5-4.0 s under a comment reading "physically reasonable BREASTSTROKE
// range" (metrics.py:961) — written in Phase 10, never revisited.
//
// ⚠ DO NOT re-introduce a `warnings.length > 0` check. api.py:180 appends the kick warning
// UNCONDITIONALLY, so that predicate flags every session and carries zero information. Phase 58-05
// caught this trap at plan time on the web side; this mirrors its verified helper and its 5%
// threshold.

export const DROPOUT_WARN_PCT = 5;

/**
 * @param {{magnet_dropout_pct?: number}|null|undefined} dataQuality
 * @returns {string|null} the warning to display, or null when there is nothing worth saying
 */
export function dropoutWarning(dataQuality) {
  const pct = dataQuality?.magnet_dropout_pct;
  if (typeof pct !== 'number' || isNaN(pct) || pct <= DROPOUT_WARN_PCT) return null;
  return `Encoder signal lost for ${pct.toFixed(1)}% of samples — this recording may be unreliable`;
}
