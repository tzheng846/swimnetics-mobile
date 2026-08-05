import { Buffer } from 'buffer';
import { colors } from '../theme';

// Shared STATUS-packet decoding — used by DiagnosticsScreen (live poll) and the
// RecordScreen pre-record encoder check. Single source of truth for the firmware contract.

// STATUS reply (firmware 1.1.0+): 15 bytes, marker 0xDD. 15 ≠ 8 (META), ≠ 1 (end
// marker), and not a multiple of 7 (samples) — so it never collides with other TX payloads.
export const STATUS_MARKER      = 0xDD;
export const STATUS_PACKET_SIZE = 15;

// AS5600 status register bits (REG 0x0B)
const MD_BIT = 0x20; // magnet detected
const ML_BIT = 0x10; // too weak  (magnet too far)
const MH_BIT = 0x08; // too strong (magnet too close)

export function parseStatus(base64) {
  if (!base64) return null;
  let buf;
  try { buf = Buffer.from(base64, 'base64'); } catch { return null; }
  if (buf.length !== STATUS_PACKET_SIZE || buf[0] !== STATUS_MARKER) return null;
  const flags = buf[6];
  return {
    statusByte:   buf[1],
    magnetOk:     buf[2] === 1,
    agc:          buf[3],
    angle:        buf.readUInt16LE(4),
    recording:    (flags & 0x01) !== 0,
    dataReady:    (flags & 0x02) !== 0,
    motorRunning: (flags & 0x04) !== 0,
    bufCount:     buf.readUInt32LE(7),
    maxSamples:   buf.readUInt32LE(11),
  };
}

// Plain-English magnet verdict from the status byte. `hardFault` is true when the
// encoder genuinely can't read (not responding / no magnet) — the cases worth warning
// about before a recording.
export function magnetVerdict(statusByte) {
  // A non-responding AS5600 (unwired / bad I2C bus) reads back as 0xFF, which sets MD, ML
  // AND MH at once. "Too weak AND too strong" is physically impossible, so treat that combo
  // (and an all-ones byte) as a wiring fault — NOT a magnet-position problem.
  if (statusByte === 0xFF || ((statusByte & ML_BIT) && (statusByte & MH_BIT))) {
    return {
      color: colors.needsWork,
      hardFault: true,
      title: 'SENSOR NOT RESPONDING',
      detail: 'The AS5600 isn’t answering on I2C — check its wiring (SDA→GPIO21, SCL→GPIO22, plus 3V3 and GND). This is a wiring fault, not a magnet position problem.',
    };
  }
  if (!(statusByte & MD_BIT)) {
    return {
      color: colors.needsWork,
      hardFault: true,
      title: 'NOT DETECTED',
      detail: 'No magnet seen. Check the AS5600 wiring (SDA→GPIO21, SCL→GPIO22) and that a magnet is mounted on the shaft. Recording is blocked until this clears.',
    };
  }
  if (statusByte & ML_BIT) {
    return { color: colors.ok, hardFault: false, title: 'Too weak', detail: 'Magnet detected but signal is weak — magnet is too far from the sensor. Move it closer.' };
  }
  if (statusByte & MH_BIT) {
    return { color: colors.ok, hardFault: false, title: 'Too strong', detail: 'Magnet detected but signal is too strong — magnet is too close to the sensor. Move it back slightly.' };
  }
  return { color: colors.good, hardFault: false, title: 'Detected ✓', detail: 'Magnet is in range. Encoder can read.' };
}
