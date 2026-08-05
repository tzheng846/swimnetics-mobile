# Race-start audio assets

Two bundled clips used by the race-start sequence (Phase 41). They are `require()`d by
`src/hooks/useStartSequence.js` and played via `expo-audio`. The feature is inert until both
files exist here.

| File | Role | Suggested length |
|------|------|------------------|
| `takeyourmarks.mp3` | Spoken "take your marks" starter voice | ~1–2 s |
| `beep.mp3` | The loud start blare / horn | ~0.5–1 s |

To swap clips, replace the files in place (keep the same names) or update the `require()` paths
in `useStartSequence.js`.
