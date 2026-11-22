'use client';
/*
 * Optional interface sounds, synthesised with the Web Audio API: no files to load.
 * OFF by default. Turn on only behind a visible sound toggle the shopper controls:
 *   IK.sound.enable();  IK.sound.play('paid');
 * Browsers start audio only after a click, tap or key press, so every cue here
 * is triggered from one of those.
 */
let enabled = false;
let ctx = null;

function audio() {
  if (typeof window === 'undefined') return null;
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
  }
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}

// Each note: [frequency Hz, start s, length s, peak gain, waveform]
const CUES = {
  tick: [[1900, 0, 0.035, 0.05, 'sine']],
  add: [
    [660, 0, 0.1, 0.09, 'triangle'],
    [990, 0.055, 0.14, 0.07, 'sine'],
  ],
  paid: [
    [784, 0, 0.14, 0.08, 'sine'],
    [1047, 0.08, 0.18, 0.08, 'sine'],
    [1568, 0.17, 0.32, 0.05, 'sine'],
  ],
  error: [
    [330, 0, 0.12, 0.07, 'triangle'],
    [247, 0.08, 0.2, 0.07, 'triangle'],
  ],
};

export const sound = {
  enable() {
    enabled = true;
  },
  disable() {
    enabled = false;
  },
  isEnabled() {
    return enabled;
  },
  /** name: 'tick' | 'add' | 'paid' | 'error' */
  play(name, { volume = 1 } = {}) {
    if (!enabled) return;
    const c = audio();
    const notes = CUES[name];
    if (!c || !notes) return;
    const t0 = c.currentTime;
    notes.forEach(([freq, start, length, peak, type]) => {
      const osc = c.createOscillator();
      const amp = c.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(freq, t0 + start);
      amp.gain.setValueAtTime(0.0001, t0 + start);
      amp.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak * volume), t0 + start + 0.008);
      amp.gain.exponentialRampToValueAtTime(0.0001, t0 + start + length);
      osc.connect(amp);
      amp.connect(c.destination);
      osc.start(t0 + start);
      osc.stop(t0 + start + length + 0.03);
    });
  },
};
