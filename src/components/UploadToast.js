// UploadToast — global, out-of-the-way surface for background video uploads (Phase 47-03).
//
// Mounted once at the App root, overlaying every screen (pointerEvents box-none so it
// never blocks the UI behind it). Two elements:
//   • transient toast (~3 s) when an upload starts / completes
//   • persistent dismissible chip per FAILED job (auto-retries exhausted) with Retry
import React, { useEffect, useRef, useState } from 'react';
import { Animated, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { subscribe, retryJob, dismissJob } from '../lib/videoUploadQueue';
import { colors, radii, spacing } from '../theme';

const TOAST_MS = 3000;

export default function UploadToast() {
  const insets = useSafeAreaInsets();
  const [failedJobs, setFailedJobs] = useState([]);
  const [toast, setToast] = useState(null); // { text }
  const prevStatusRef = useRef({}); // jobId -> last seen status
  const toastTimerRef = useRef(null);
  const opacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const unsub = subscribe(jobsSnap => {
      setFailedJobs(jobsSnap.filter(j => j.status === 'failed'));

      // Toast on status transitions only (not on every snapshot).
      const prev = prevStatusRef.current;
      let next = null;
      for (const j of jobsSnap) {
        if (prev[j.id] === j.status) continue;
        if (j.status === 'uploading' && j.attempts <= 1) next = 'Uploading video…';
        if (j.status === 'done') next = 'Video saved to cloud ✓';
      }
      prevStatusRef.current = Object.fromEntries(jobsSnap.map(j => [j.id, j.status]));
      if (next) showToast(next);
    });
    return unsub;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const showToast = text => {
    setToast({ text });
    clearTimeout(toastTimerRef.current);
    Animated.timing(opacity, { toValue: 1, duration: 180, useNativeDriver: true }).start();
    toastTimerRef.current = setTimeout(() => {
      Animated.timing(opacity, { toValue: 0, duration: 300, useNativeDriver: true }).start(
        () => setToast(null),
      );
    }, TOAST_MS);
  };

  useEffect(() => () => clearTimeout(toastTimerRef.current), []);

  if (!toast && failedJobs.length === 0) return null;

  // Sits above the floating tab bar pill (~72 px) on tab screens; harmless elsewhere.
  const bottom = insets.bottom + 88;

  return (
    <View pointerEvents="box-none" style={[styles.host, { bottom }]}>
      {failedJobs.map(j => (
        <View key={j.id} style={styles.chip}>
          <View style={styles.chipBody}>
            <Text style={styles.chipText} numberOfLines={1}>
              Video upload failed
            </Text>
            {/* The reason was always stored on the job and never shown — which is how an
                over-cap clip could go missing with no explanation (Phase 84-05). */}
            {!!j.lastError && (
              <Text style={styles.chipReason} numberOfLines={2}>
                {j.lastError}
              </Text>
            )}
          </View>
          {/* No Retry on a permanent failure: it would re-run the same check and fail
              identically, so the button would be a false affordance. */}
          {!j.permanent && (
            <TouchableOpacity onPress={() => retryJob(j.id)} hitSlop={HIT}>
              <Text style={styles.chipAction}>Retry</Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity onPress={() => dismissJob(j.id)} hitSlop={HIT}>
            <Text style={styles.chipDismiss}>✕</Text>
          </TouchableOpacity>
        </View>
      ))}
      {toast && (
        <Animated.View style={[styles.toast, { opacity }]} pointerEvents="none">
          <Text style={styles.toastText}>{toast.text}</Text>
        </Animated.View>
      )}
    </View>
  );
}

const HIT = { top: 8, bottom: 8, left: 8, right: 8 };

const styles = StyleSheet.create({
  host: {
    position: 'absolute',
    left: 0,
    right: 0,
    alignItems: 'center',
    gap: spacing.sm,
  },
  toast: {
    backgroundColor: colors.text, // dark pill on the light theme — high contrast, iOS-like
    borderRadius: radii.pill,
    paddingHorizontal: spacing.lg,
    paddingVertical: 10,
    maxWidth: '86%',
    shadowColor: '#000',
    shadowOpacity: 0.18,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 4,
  },
  toastText: { color: colors.white, fontSize: 13, fontWeight: '600' },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.needsWorkBg,
    borderColor: colors.needsWork,
    borderWidth: 1,
    borderRadius: radii.pill,
    paddingHorizontal: spacing.lg,
    paddingVertical: 8,
    maxWidth: '86%',
  },
  chipBody: { flexShrink: 1 },
  chipText: { color: colors.needsWork, fontSize: 13, fontWeight: '600', flexShrink: 1 },
  // Muted against needsWorkBg but still legible — this line carries the actual reason.
  chipReason: { color: colors.text, fontSize: 11, lineHeight: 14, marginTop: 2, opacity: 0.8 },
  chipAction: { color: colors.primary, fontSize: 13, fontWeight: '700' },
  chipDismiss: { color: colors.textMuted, fontSize: 13, fontWeight: '700' },
});
