// Procedural WebAudio — wind ambience, piano loop, and gameplay blips. No asset files.

interface PianoNote {
  midi: number;
  t: number;
  dur: number;
  vel: number;
}

const MIDI_A4 = 69;

function midiToHz(midi: number): number {
  return 440 * Math.pow(2, (midi - MIDI_A4) / 12);
}

// Build a gentle arpeggiated piano loop from chord roots + optional melody.
function buildArpeggioScore(
  chords: number[][],
  melody: number[],
  beat = 0.82,
  bars = 8
): PianoNote[] {
  const notes: PianoNote[] = [];
  for (let bar = 0; bar < bars; bar++) {
    const base = bar * beat * 4;
    const chord = chords[bar % chords.length];
    for (let i = 0; i < chord.length; i++) {
      notes.push({
        midi: chord[i],
        t: base + i * beat * 0.55,
        dur: beat * 2.8,
        vel: 0.18 + (i === 0 ? 0.1 : 0.04),
      });
    }
    if (bar % 2 === 1 && melody.length) {
      notes.push({
        midi: melody[bar % melody.length],
        t: base + beat * 2.2,
        dur: beat * 2.4,
        vel: 0.14,
      });
    }
  }
  return notes;
}

function loopDuration(score: PianoNote[]): number {
  return Math.max(...score.map((n) => n.t + n.dur)) + 1.2;
}

const PIANO_SCORES: PianoNote[][] = [
  buildArpeggioScore(
    [
      [57, 60, 64, 69],
      [53, 57, 60, 64],
      [48, 55, 60, 64],
      [55, 59, 62, 67],
    ],
    [72, 69, 67, 64, 62, 60, 64, 67]
  ),
  buildArpeggioScore(
    [
      [62, 65, 69, 74],
      [57, 60, 64, 67],
      [59, 62, 66, 71],
      [55, 59, 62, 67],
    ],
    [74, 71, 69, 67, 66, 64, 67, 69]
  ),
  buildArpeggioScore(
    [
      [53, 57, 60, 65],
      [48, 52, 55, 60],
      [50, 53, 57, 62],
      [55, 58, 62, 65],
    ],
    [65, 62, 60, 57, 55, 53, 57, 60]
  ),
];

const MUSIC_LOOP_SECS = PIANO_SCORES.map(loopDuration);

export class Sound {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private windGain: GainNode | null = null;
  private windFilter: BiquadFilterNode | null = null;
  private musicGain: GainNode | null = null;
  private started = false;
  private musicNextTime = 0;
  private musicTimer: ReturnType<typeof setTimeout> | null = null;
  private musicPaused = false;
  private musicScoreIdx = 0;
  enabled = true;

  // Must be called from a user gesture (pointerdown / keydown) to satisfy
  // browser autoplay policies.
  resume() {
    if (!this.enabled) return;
    if (!this.ctx) this.init();
    this.ctx?.resume();
    if (!this.started) this.startAmbience();
    if (!this.musicPaused) this.ensureMusicScheduled();
  }

  private init() {
    try {
      const Ctx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext })
          .webkitAudioContext;
      this.ctx = new Ctx();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.7;
      this.master.connect(this.ctx.destination);

      this.musicGain = this.ctx.createGain();
      this.musicGain.gain.value = 0.34;
      this.musicGain.connect(this.master);
    } catch {
      this.ctx = null;
    }
  }

  private startAmbience() {
    if (!this.ctx || !this.master) return;

    const noise = this.ctx.createBufferSource();
    const buf = this.ctx.createBuffer(
      1,
      this.ctx.sampleRate * 2,
      this.ctx.sampleRate
    );
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    noise.buffer = buf;
    noise.loop = true;

    const filter = this.ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = 500;

    const gain = this.ctx.createGain();
    gain.gain.value = 0.0;

    noise.connect(filter);
    filter.connect(gain);
    gain.connect(this.master);
    noise.start();

    this.windFilter = filter;
    this.windGain = gain;
    this.started = true;
  }

  setMusicPaused(paused: boolean) {
    this.musicPaused = paused;
    if (!this.ctx || !this.musicGain) return;
    const t = this.ctx.currentTime;
    this.musicGain.gain.setTargetAtTime(paused ? 0 : 0.34, t, 0.08);
    if (paused) {
      this.clearMusicTimer();
    } else if (this.started && this.enabled) {
      this.musicNextTime = 0;
      this.ensureMusicScheduled();
    }
  }

  // level 0..1 (typically tied to speed). Smoothly ramps wind volume + tone.
  setWind(level: number) {
    if (!this.ctx || !this.windGain || !this.windFilter) return;
    const t = this.ctx.currentTime;
    const target = this.enabled ? Math.min(0.16, 0.02 + level * 0.16) : 0;
    this.windGain.gain.setTargetAtTime(target, t, 0.15);
    this.windFilter.frequency.setTargetAtTime(400 + level * 1400, t, 0.2);
  }

  setMuted(muted: boolean) {
    this.enabled = !muted;
    if (this.master && this.ctx) {
      this.master.gain.setTargetAtTime(muted ? 0 : 0.7, this.ctx.currentTime, 0.05);
    }
    if (muted) {
      this.clearMusicTimer();
    } else if (this.started && !this.musicPaused) {
      this.musicNextTime = 0;
      this.ensureMusicScheduled();
    }
  }

  private clearMusicTimer() {
    if (this.musicTimer !== null) {
      clearTimeout(this.musicTimer);
      this.musicTimer = null;
    }
  }

  private ensureMusicScheduled() {
    if (!this.ctx || !this.musicGain || !this.enabled || this.musicPaused) return;
    if (this.musicTimer !== null) return;
    if (this.musicNextTime <= 0) {
      this.musicNextTime = this.ctx.currentTime + 0.08;
    }
    this.scheduleMusicLoop();
  }

  private scheduleMusicLoop() {
    if (!this.ctx || !this.musicGain || !this.enabled || this.musicPaused) {
      this.clearMusicTimer();
      return;
    }

    const score = PIANO_SCORES[this.musicScoreIdx];
    const loopSec = MUSIC_LOOP_SECS[this.musicScoreIdx];
    const start = Math.max(this.ctx.currentTime + 0.05, this.musicNextTime);
    for (const note of score) {
      this.playPianoNote(midiToHz(note.midi), start + note.t, note.dur, note.vel);
    }

    this.musicNextTime = start + loopSec;
    this.musicScoreIdx = (this.musicScoreIdx + 1) % PIANO_SCORES.length;
    const leadMs = Math.max(500, (loopSec - 1.5) * 1000);
    this.musicTimer = setTimeout(() => {
      this.musicTimer = null;
      this.scheduleMusicLoop();
    }, leadMs);
  }

  private playPianoNote(
    freq: number,
    time: number,
    duration: number,
    velocity: number
  ) {
    if (!this.ctx || !this.musicGain || !this.enabled) return;

    const osc = this.ctx.createOscillator();
    const body = this.ctx.createOscillator();
    const filter = this.ctx.createBiquadFilter();
    const gain = this.ctx.createGain();

    osc.type = "sine";
    osc.frequency.setValueAtTime(freq, time);
    body.type = "triangle";
    body.frequency.setValueAtTime(freq * 2, time);

    filter.type = "lowpass";
    filter.frequency.setValueAtTime(Math.min(4200, freq * 6), time);
    filter.Q.value = 0.6;

    const peak = velocity * 0.55;
    gain.gain.setValueAtTime(0.0001, time);
    gain.gain.linearRampToValueAtTime(peak, time + 0.018);
    gain.gain.exponentialRampToValueAtTime(peak * 0.35, time + 0.22);
    gain.gain.exponentialRampToValueAtTime(0.0001, time + duration);

    osc.connect(filter);
    body.connect(filter);
    filter.connect(gain);
    gain.connect(this.musicGain);

    osc.start(time);
    body.start(time);
    osc.stop(time + duration + 0.05);
    body.stop(time + duration + 0.05);
  }

  private blip(
    freq: number,
    dur: number,
    type: OscillatorType,
    gain: number,
    slideTo?: number
  ) {
    if (!this.ctx || !this.master || !this.enabled) return;
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g);
    g.connect(this.master);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  grab() {
    this.blip(220, 0.16, "triangle", 0.12, 360);
  }
  release() {
    this.blip(520, 0.22, "sawtooth", 0.1, 180);
  }
  perfect() {
    this.blip(660, 0.18, "triangle", 0.16, 990);
    this.blip(990, 0.26, "sine", 0.12, 1320);
  }
  collect() {
    this.blip(880, 0.1, "sine", 0.09, 1240);
  }
  dash() {
    this.blip(160, 0.45, "sawtooth", 0.16, 1100);
  }
  crash() {
    this.blip(140, 0.5, "square", 0.18, 50);
  }
}
