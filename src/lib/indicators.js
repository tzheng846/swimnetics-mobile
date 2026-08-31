import { colors } from '../theme';

// Single source of truth for how a rating band READS on every mobile surface (Phase 84-03, item 5).
//
// Before this module the roster, the athlete page, the dashboard and the report card each derived
// band -> color and band -> label for themselves, in four different forms and two different
// casings. This file owns the vocabulary; those four surfaces ask it.
//
// Deliberately RN-free and single-import so `scratch/indicator_check.mjs` in the backend repo can
// import it under plain node by rewriting the one specifier below. Do not add react/react-native
// imports here — put anything that renders in components/ui/BandDot.js instead.
//
// Color contract (theme/tokens.js:39): the API payload's `rating_colors` wins; the theme tokens are
// a fallback only. `rating_colors` carries exactly good/ok/needs_work (ratings.py:33) — `unknown`
// means "no rating", so there is nothing for the rating engine to color and the client owns it.

export const BAND_KEYS = ['good', 'ok', 'needs_work', 'unknown'];

// Canon casing. Matches the report card and the web coach portal; the athlete page's old lowercase
// set and its `—` for unknown were the outliers.
export const BAND_LABEL = {
  good: 'Good',
  ok: 'OK',
  needs_work: 'Needs work',
  unknown: 'No data',
};

// Bands are snake_case; theme token keys are camelCase — map explicitly.
const BAND_FALLBACK = {
  good: colors.good,
  ok: colors.ok,
  needs_work: colors.needsWork,
  unknown: colors.textMuted,
};

export const PROVISIONAL_SUFFIX = ' (provisional)';
export const PROVISIONAL_NOTE = '⚠ Provisional — stroke segmentation is still being validated.';

// Total over BAND_KEYS and over any unrecognized string, with or without a payload, so no caller
// needs its own `||` tail.
export function bandColor(band, ratingColors) {
  return (ratingColors && ratingColors[band]) || BAND_FALLBACK[band] || colors.textMuted;
}

export function bandLabel(band, provisional) {
  const label = BAND_LABEL[band] || BAND_LABEL.unknown;
  return provisional ? label + PROVISIONAL_SUFFIX : label;
}

// A trusted band is a filled swatch; a provisional one is a hollow ring in the same band color.
// ⚠ `provisional` is currently unreachable in the shipped ratings engine (ratings.py:206 — both
// halves of its derivation are dead since Phase 54). This branch exists so the day that flag is
// re-armed it lands on a defined treatment, not so it fixes anything observable today.
export function bandDotStyle(band, ratingColors, provisional, size = 10) {
  const c = bandColor(band, ratingColors);
  const base = { width: size, height: size, borderRadius: size / 2 };
  return provisional
    ? { ...base, backgroundColor: 'transparent', borderWidth: Math.max(1.5, size * 0.2), borderColor: c }
    : { ...base, backgroundColor: c };
}
