import { useCallback, useEffect, useRef, useState } from 'react';
import { useAudioPlayer, setAudioModeAsync } from 'expo-audio';

// Two bundled clips (user-supplied — see assets/audio/README.md).
const VOICE = require('../../assets/audio/takeyourmarks.mp3');
const HORN = require('../../assets/audio/beep.mp3');

const CANCELED = Symbol('start-sequence-canceled');

// Drives the race-start cadence: 3 → 2 → 1 (visual) → "take your marks" (voice)
// → random 2–3 s hold → blare. run() resolves AT the blare so recording begins on it.
// phase ∈ null | count3 | count2 | count1 | marks | hold | blare.
export default function useStartSequence() {
  const [phase, setPhase] = useState(null);
  const voice = useAudioPlayer(VOICE);
  const horn = useAudioPlayer(HORN);
  const canceledRef = useRef(false);
  const timerRef = useRef(null);

  // Play even when the phone's ringer is on silent (iOS).
  useEffect(() => {
    setAudioModeAsync({ playsInSilentMode: true }).catch(() => {});
  }, []);

  const run = useCallback(async () => {
    canceledRef.current = false;
    const guard = () => { if (canceledRef.current) throw CANCELED; };

    // Cancelable delay — cancel() clears the timer and forces a CANCELED throw.
    const wait = (ms) => new Promise((resolve, reject) => {
      timerRef.current = setTimeout(() => {
        timerRef.current = null;
        canceledRef.current ? reject(CANCELED) : resolve();
      }, ms);
    });

    // Play the voice and resolve when it finishes (with a safety timeout so a
    // missing didJustFinish never strands the sequence).
    const playVoice = () => new Promise((resolve) => {
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        sub?.remove?.();
        clearTimeout(safety);
        resolve();
      };
      const sub = voice.addListener('playbackStatusUpdate', (s) => {
        if (s?.didJustFinish) finish();
      });
      const safety = setTimeout(finish, 2500);
      try { voice.seekTo(0); voice.play(); } catch { finish(); }
    });

    try {
      setPhase('count3'); await wait(1000); guard();
      setPhase('count2'); await wait(1000); guard();
      setPhase('count1'); await wait(1000); guard();
      setPhase('marks');  await playVoice(); guard();
      setPhase('hold');   await wait(2000 + Math.floor(Math.random() * 1000)); guard();

      // Blare — recording starts on this beat, so resolve immediately at play.
      setPhase('blare');
      try { horn.seekTo(0); horn.play(); } catch {}
      setTimeout(() => setPhase(null), 600);
      return { canceled: false };
    } catch {
      setPhase(null);
      return { canceled: true };
    }
  }, [voice, horn]);

  const cancel = useCallback(() => {
    canceledRef.current = true;
    if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null; }
    try { voice.pause(); } catch {}
    try { horn.pause(); } catch {}
    setPhase(null);
  }, [voice, horn]);

  // Stop any in-flight sequence if the screen unmounts.
  useEffect(() => () => {
    canceledRef.current = true;
    if (timerRef.current) clearTimeout(timerRef.current);
  }, []);

  return { phase, run, cancel };
}
