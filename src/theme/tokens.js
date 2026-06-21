// Swimnetics design tokens — single source of truth for the mobile UI (Phase 38).
// Light theme (approved 2026-06-19). Structured so a dark variant can be added later
// without touching component code: components read token keys, never raw hex.

export const colors = {
  // Brand (user-chosen)
  primary:         '#4e148c',  // CTAs, active tab, FAB — solid fill
  primaryPressed:  '#3d0f6e',
  secondary:       '#613dc1',
  secondaryPressed:'#ece6f7',  // pressed bg for the tonal secondary button
  accent:          '#97dffc',  // AI surfaces ONLY — use sparingly
  accentPressed:   '#7fd3f9',
  periwinkle:      '#858ae3',  // eyebrow text, links, secondary accents
  dangerPressed:   '#9c2e22',

  // Text (text = user; secondary/muted derived)
  text:           '#2c0735',
  textSecondary:  '#6e5a78',
  textMuted:      '#9b8ba6',

  // Surfaces (bg = user; rest derived)
  bg:             '#fbfbfe',
  surface:        '#ffffff',
  surfaceAlt:     '#f4f1fb',  // inputs, chips, tiles, table cells
  border:         '#e8e4f2',
  white:          '#ffffff',

  // AI surface tint (accent, lightened for backgrounds)
  accentBg:       '#eaf7fe',
  accentBorder:   '#c7ecfb',
  accentText:     '#0d3a50',

  // Modal scrim (brand text color at low alpha)
  scrim:          'rgba(44,7,53,0.35)',

  // On-dark accents (immersive active-recording screen, which uses `text` as its bg)
  dangerOnDark:   '#ff8a8a',

  // Rating bands (fallback only — band UI must read colors from the API payload)
  good:           '#2d9e5f',
  ok:             '#d4860a',
  needsWork:      '#c0392b',
  goodBg:         '#e7f4ec',
  okBg:           '#fbf0db',
  needsWorkBg:    '#f7e8e6',
};

export const type = {
  display: { fontSize: 28, fontWeight: '700' },
  title:   { fontSize: 22, fontWeight: '700' },
  heading: { fontSize: 17, fontWeight: '600' },
  body:    { fontSize: 15, fontWeight: '400' },
  label:   { fontSize: 13, fontWeight: '500' },
  caption: { fontSize: 12, fontWeight: '400' },
};

export const spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 20, xxl: 24, xxxl: 32 };

export const radii = { sm: 8, md: 12, lg: 16, pill: 999 };

export const shadow = {
  card:   { shadowColor: '#2c0735', shadowOpacity: 0.05, shadowRadius: 8,  shadowOffset: { width: 0, height: 2 }, elevation: 2 },
  island: { shadowColor: '#4e148c', shadowOpacity: 0.30, shadowRadius: 10, shadowOffset: { width: 0, height: 4 }, elevation: 8 },
};

export const motion = { fast: 150, base: 220, slow: 320 };
