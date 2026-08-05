import React from 'react';
import { View, Pressable, StyleSheet } from 'react-native';
import AppText from './ui/AppText';

const COUNT = { count3: '3', count2: '2', count1: '1' };

// Full-screen race-start overlay. Reads `phase` from useStartSequence; renders nothing when idle.
// Sits above both the plain record screen and the live camera preview.
export default function StartSequenceOverlay({ phase, onCancel }) {
  if (!phase) return null;
  const isBlare = phase === 'blare';
  const isMarks = phase === 'marks' || phase === 'hold';

  return (
    <View style={[StyleSheet.absoluteFill, styles.overlay, isBlare && styles.flash]} pointerEvents="auto">
      <Pressable style={styles.cancel} onPress={onCancel} hitSlop={12}>
        <AppText variant="label" style={{ color: isBlare ? '#2c0735' : '#ffffff' }}>Cancel</AppText>
      </Pressable>

      {COUNT[phase] ? (
        <AppText style={styles.count}>{COUNT[phase]}</AppText>
      ) : isMarks ? (
        <AppText style={styles.marks}>Take your marks</AppText>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: { backgroundColor: 'rgba(8,4,18,0.86)', alignItems: 'center', justifyContent: 'center', zIndex: 50 },
  flash: { backgroundColor: '#97dffc' },
  cancel: { position: 'absolute', top: 56, right: 24 },
  count: { fontSize: 180, lineHeight: 200, fontWeight: '800', color: '#ffffff' },
  marks: { fontSize: 40, fontWeight: '700', color: '#ffffff', textAlign: 'center', paddingHorizontal: 24 },
});
