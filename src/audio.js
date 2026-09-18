/**
 * Arcade sound effects built entirely from the Web Audio API.
 *
 * No samples, no downloads -- every sound is a couple of oscillators with an
 * envelope, which is exactly what the real machines sound like anyway (cheap
 * piezo buzzers inside a plastic cabinet).
 *
 * Browsers require a user gesture before an AudioContext can produce sound, so
 * `unlock()` is called from the first click / keypress.
 */

const MASTER_LEVEL = 0.32;

class ArcadeAudio {
  constructor() {
    /** @type {AudioContext|null} */
    this.ctx = null;
    this.master = null;
    this.muted = false;
    /** Limit peg blips so a flurry of hits does not turn into white noise. */
    this.lastPegTime = 0;
  }

  /** Create (or resume) the AudioContext. Safe to call on every gesture. */
  unlock() {
    if (!this.ctx) {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return false;
      this.ctx = new Ctx();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.muted ? 0 : MASTER_LEVEL;
      this.master.connect(this.ctx.destination);
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
    return true;
  }

  setMuted(muted) {
    this.muted = muted;
    if (this.master) {
      const now = this.ctx.currentTime;
      this.master.gain.cancelScheduledValues(now);
      this.master.gain.setTargetAtTime(muted ? 0 : MASTER_LEVEL, now, 0.02);
    }
  }

  toggleMute() {
    this.setMuted(!this.muted);
    return this.muted;
  }

  get ready() {
    return Boolean(this.ctx) && this.ctx.state === 'running' && !this.muted;
  }

  /**
   * One shot of a pitched, enveloped oscillator.
   * @param {object} o
   * @param {number} o.freq      start frequency
   * @param {number} [o.endFreq] frequency to glide to
   * @param {OscillatorType} [o.type]
   * @param {number} [o.duration] seconds
   * @param {number} [o.gain]
   * @param {number} [o.delay]   seconds from now
   */
  tone({ freq, endFreq, type = 'square', duration = 0.12, gain = 0.35, delay = 0 }) {
    if (!this.ready) return;
    const ctx = this.ctx;
    const t0 = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    const env = ctx.createGain();

    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (endFreq && endFreq !== freq) {
      osc.frequency.exponentialRampToValueAtTime(Math.max(20, endFreq), t0 + duration);
    }

    // Fast attack, exponential decay. Avoids clicks.
    env.gain.setValueAtTime(0.0001, t0);
    env.gain.exponentialRampToValueAtTime(gain, t0 + 0.006);
    env.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);

    osc.connect(env).connect(this.master);
    osc.start(t0);
    osc.stop(t0 + duration + 0.02);
  }

  /** Filtered noise burst -- used for the mechanical clack of the plunger. */
  noise({ duration = 0.08, gain = 0.18, filterFreq = 1800, q = 1.2, delay = 0 }) {
    if (!this.ready) return;
    const ctx = this.ctx;
    const t0 = ctx.currentTime + delay;
    const frames = Math.max(1, Math.floor(ctx.sampleRate * duration));
    const buffer = ctx.createBuffer(1, frames, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < frames; i++) {
      // Linear fade instead of a filter envelope: cheaper, sounds fine.
      data[i] = (Math.random() * 2 - 1) * (1 - i / frames);
    }

    const src = ctx.createBufferSource();
    src.buffer = buffer;

    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = filterFreq;
    filter.Q.value = q;

    const env = ctx.createGain();
    env.gain.setValueAtTime(gain, t0);
    env.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);

    src.connect(filter).connect(env).connect(this.master);
    src.start(t0);
    src.stop(t0 + duration + 0.02);
  }

  // ---------------------------------------------------------------- game SFX

  /** Player pressed 開始. */
  start() {
    this.tone({ freq: 520, endFreq: 1050, type: 'square', duration: 0.14, gain: 0.3 });
    this.tone({ freq: 780, endFreq: 1560, type: 'square', duration: 0.16, gain: 0.22, delay: 0.09 });
  }

  /** The LED target roulette ticking. */
  tick() {
    this.tone({ freq: 1500, type: 'square', duration: 0.035, gain: 0.14 });
  }

  /** The roulette locked onto the target. */
  lock() {
    this.tone({ freq: 900, type: 'square', duration: 0.1, gain: 0.28 });
    this.tone({ freq: 1350, type: 'square', duration: 0.18, gain: 0.26, delay: 0.1 });
  }

  /** Ball dropped into the barrel. */
  load() {
    this.noise({ duration: 0.06, gain: 0.14, filterFreq: 2600, q: 2.0 });
  }

  /** Plunger spring creaking while the player holds it back. */
  pull(amount) {
    this.tone({
      freq: 150 + amount * 220,
      endFreq: 170 + amount * 260,
      type: 'sawtooth',
      duration: 0.07,
      gain: 0.05,
    });
  }

  /** Plunger released. */
  launch(power) {
    this.noise({ duration: 0.09, gain: 0.12 + power * 0.16, filterFreq: 900 + power * 2200, q: 0.9 });
    this.tone({ freq: 240 + power * 260, endFreq: 90, type: 'triangle', duration: 0.13, gain: 0.22 });
  }

  /** Ball ticked a brass pin. Rate limited so it stays crisp. */
  peg(strength = 0.5) {
    if (!this.ready) return;
    const now = this.ctx.currentTime;
    if (now - this.lastPegTime < 0.022) return;
    this.lastPegTime = now;
    const f = 1700 + Math.random() * 900 + strength * 900;
    this.tone({ freq: f, endFreq: f * 0.72, type: 'square', duration: 0.035, gain: 0.055 + strength * 0.06 });
  }

  /** Ball thumped a big bumper post. */
  bumper() {
    this.tone({ freq: 420, endFreq: 900, type: 'square', duration: 0.09, gain: 0.22 });
    this.noise({ duration: 0.05, gain: 0.1, filterFreq: 1400, q: 1.4 });
  }

  /** Ball dropped into a scoring slot. */
  pocket() {
    this.noise({ duration: 0.12, gain: 0.16, filterFreq: 700, q: 1.1 });
    this.tone({ freq: 300, endFreq: 180, type: 'triangle', duration: 0.14, gain: 0.2 });
  }

  /** Correct target hit. */
  win() {
    const notes = [660, 880, 1100, 1320];
    notes.forEach((f, i) => {
      this.tone({ freq: f, type: 'square', duration: 0.13, gain: 0.26, delay: i * 0.075 });
    });
  }

  /** Wrong slot. */
  miss() {
    this.tone({ freq: 320, endFreq: 150, type: 'sawtooth', duration: 0.24, gain: 0.2 });
  }

  /** Game over jingle. */
  gameOver() {
    const notes = [880, 740, 590, 440, 330];
    notes.forEach((f, i) => {
      this.tone({ freq: f, type: 'square', duration: 0.19, gain: 0.24, delay: i * 0.14 });
    });
  }

  /** Ball drained without scoring (it left the playfield sideways). */
  drain() {
    this.tone({ freq: 220, endFreq: 120, type: 'triangle', duration: 0.2, gain: 0.18 });
  }
}

export const audio = new ArcadeAudio();