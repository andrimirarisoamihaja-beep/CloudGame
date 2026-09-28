"use client";

/**
 * Every sound in Cloud Sculptor is synthesised at runtime with Tone.js — there
 * is not a single audio file in the repository.
 *
 * Layers
 *  - ambient pad : 3 oscillators (sine / triangle / sine) with a slow detune LFO,
 *                  through a long reverb; brightness follows the wind.
 *  - cloud voices: one soft oscillator per cloud. Round, dense clouds hum low
 *                  (100–200 Hz, sine); stretched, thin ones sing high
 *                  (400–800 Hz, triangle). Volume follows the cloud's mass and
 *                  stereo position follows its place in the sky.
 *  - wind        : pink noise through a sweeping lowpass, gain follows wind speed.
 *  - rain        : white noise through a bandpass, gain follows rainfall.
 *  - thunder     : brown-noise burst through a lowpass, triggered by lightning.
 *
 * Nothing is created until `start()` is called from a user gesture, and Tone is
 * imported dynamically so the module never touches the server bundle.
 */

type ToneModule = typeof import("tone");
type Noise = InstanceType<ToneModule["Noise"]>;
type Filter = InstanceType<ToneModule["Filter"]>;
type Osc = InstanceType<ToneModule["Oscillator"]>;
type LFO = InstanceType<ToneModule["LFO"]>;
type Gain = InstanceType<ToneModule["Gain"]>;
type Reverb = InstanceType<ToneModule["Reverb"]>;
type Limiter = InstanceType<ToneModule["Limiter"]>;
type NoiseSynth = InstanceType<ToneModule["NoiseSynth"]>;
type Panner = InstanceType<ToneModule["Panner"]>;

export interface CloudVoiceInput {
  id: string;
  roundness: number;
  mass: number;
  /** –1 (left) … 1 (right) */
  pan: number;
  density: number;
}

export interface AudioFrame {
  wind: number;
  rain: number;
  /** 0–1 night-ness, shifts the pad chord. */
  night: number;
  mood: number;
  overcast: number;
  clouds: CloudVoiceInput[];
}

interface CloudVoice {
  osc: Osc;
  gain: Gain;
  panner: Panner;
  filter: Filter;
}

const PAD_ROOT = 110; // A2
const DAY_CHORD = [1, 1.5, 2]; // root, fifth, octave — open and calm
const NIGHT_CHORD = [1, 1.2, 1.5]; // root, minor third, fifth — a touch wistful

function dbFromUnit(value: number, floor = -60): number {
  const v = Math.max(0, Math.min(1, value));
  if (v <= 0.0001) return floor;
  return Math.max(floor, 20 * Math.log10(v));
}

class AudioEngine {
  private tone: ToneModule | null = null;
  private starting: Promise<void> | null = null;
  private ready = false;
  private disposed = false;

  private master: Gain | null = null;
  private limiter: Limiter | null = null;
  private reverb: Reverb | null = null;
  private wet: Gain | null = null;

  private padGains: Gain[] = [];
  private padFilters: Filter[] = [];
  private padOscs: Osc[] = [];
  private padLfo: LFO | null = null;

  private windNoise: Noise | null = null;
  private windFilter: Filter | null = null;
  private windGain: Gain | null = null;
  private windLfo: LFO | null = null;

  private rainNoise: Noise | null = null;
  private rainFilter: Filter | null = null;
  private rainGain: Gain | null = null;

  private thunder: NoiseSynth | null = null;
  private thunderFilter: Filter | null = null;
  private thunderGain: Gain | null = null;

  private voices = new Map<string, CloudVoice>();

  private volume = 0.65;
  private enabled = false;

  get isReady(): boolean {
    return this.ready;
  }

  get isEnabled(): boolean {
    return this.enabled;
  }

  /** Safe to call from any user gesture; resolves once the graph exists. */
  async start(): Promise<void> {
    if (this.ready || this.disposed) return;
    if (this.starting) return this.starting;
    this.starting = this.build().catch((error) => {
      this.starting = null;
      throw error;
    });
    return this.starting;
  }

  private async build(): Promise<void> {
    const Tone = await import("tone");
    this.tone = Tone;
    await Tone.start();

    if (this.disposed) return;

    const master = new Tone.Gain(dbFromUnit(this.enabled ? this.volume : 0, -80));
    const limiter = new Tone.Limiter(-2).toDestination();
    master.connect(limiter);
    this.master = master;
    this.limiter = limiter;

    const reverb = new Tone.Reverb({ decay: 9, preDelay: 0.02, wet: 1 });
    await reverb.generate();
    if (this.disposed) return;
    reverb.connect(limiter);
    const wet = new Tone.Gain(0.5);
    wet.connect(reverb);
    this.reverb = reverb;
    this.wet = wet;

    // --- ambient pad -------------------------------------------------------
    const padLfo = new Tone.LFO({ frequency: 0.045, min: -14, max: 14 });
    padLfo.start();
    this.padLfo = padLfo;

    const padTypes: Array<"sine" | "triangle" | "sine"> = ["sine", "triangle", "sine"];
    for (let i = 0; i < 3; i += 1) {
      const osc = new Tone.Oscillator({ frequency: PAD_ROOT * DAY_CHORD[i], type: padTypes[i] });
      const gain = new Tone.Gain(dbFromUnit(i === 0 ? 0.16 : 0.09));
      const filter = new Tone.Filter({ type: "lowpass", frequency: 900, Q: 0.4 });
      osc.connect(filter);
      filter.connect(gain);
      gain.connect(master);
      gain.connect(wet);
      padLfo.connect(osc.detune);
      osc.start();
      this.padOscs.push(osc);
      this.padGains.push(gain);
      this.padFilters.push(filter);
    }

    // --- wind --------------------------------------------------------------
    const windNoise = new Tone.Noise({ type: "pink", volume: -Infinity });
    const windFilter = new Tone.Filter({ type: "lowpass", frequency: 480, Q: 1.2, rolloff: -24 });
    // No true formant filter in Tone, so a resonant lowpass swept by an LFO
    // stands in for the vowel-like colouration of air moving past the ear.
    const windLfo = new Tone.LFO({ frequency: 0.09, min: 260, max: 1150 });
    const windGain = new Tone.Gain(dbFromUnit(0));
    windNoise.connect(windFilter);
    windFilter.connect(windGain);
    windGain.connect(master);
    windGain.connect(wet);
    windLfo.connect(windFilter.frequency);
    windNoise.start();
    windLfo.start();
    this.windNoise = windNoise;
    this.windFilter = windFilter;
    this.windGain = windGain;
    this.windLfo = windLfo;

    // --- rain --------------------------------------------------------------
    const rainNoise = new Tone.Noise({ type: "white", volume: -Infinity });
    const rainFilter = new Tone.Filter({ type: "bandpass", frequency: 1600, Q: 0.55 });
    const rainGain = new Tone.Gain(dbFromUnit(0));
    rainNoise.connect(rainFilter);
    rainFilter.connect(rainGain);
    rainGain.connect(master);
    rainGain.connect(wet);
    rainNoise.start();
    this.rainNoise = rainNoise;
    this.rainFilter = rainFilter;
    this.rainGain = rainGain;

    // --- thunder -----------------------------------------------------------
    const thunderFilter = new Tone.Filter({ type: "lowpass", frequency: 220, Q: 0.6, rolloff: -24 });
    const thunderGain = new Tone.Gain(dbFromUnit(0.9));
    const thunder = new Tone.NoiseSynth({
      noise: { type: "brown" },
      envelope: { attack: 0.02, decay: 2.6, sustain: 0.0, release: 1.2 },
    });
    thunder.connect(thunderFilter);
    thunderFilter.connect(thunderGain);
    thunderGain.connect(master);
    thunderGain.connect(wet);
    this.thunder = thunder;
    this.thunderFilter = thunderFilter;
    this.thunderGain = thunderGain;

    this.ready = true;
    this.applyMaster();
  }

  private applyMaster(): void {
    if (!this.master) return;
    const target = this.enabled ? dbFromUnit(this.volume, -80) : -80;
    this.master.gain.rampTo(target, 0.35);
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (enabled) void this.start();
    this.applyMaster();
  }

  setVolume(volume: number): void {
    this.volume = Math.max(0, Math.min(1, volume));
    if (this.enabled) this.applyMaster();
  }

  /** Called ~8×/second with the current weather + cloud metrics. */
  update(frame: AudioFrame): void {
    if (!this.ready || !this.enabled) return;

    const windLevel = 0.04 + frame.wind * 0.5;
    this.windGain?.gain.rampTo(dbFromUnit(windLevel), 0.4);
    this.rainGain?.gain.rampTo(dbFromUnit(frame.rain * 0.5), 0.4);
    this.windFilter?.frequency.rampTo(320 + frame.wind * 900 + frame.overcast * 160, 0.6);
    this.rainFilter?.frequency.rampTo(1100 + frame.rain * 900, 0.6);

    // Pad: wind makes it breathe, night makes it minor and darker.
    const chord = frame.night > 0.5 ? NIGHT_CHORD : DAY_CHORD;
    for (let i = 0; i < this.padOscs.length; i += 1) {
      const osc = this.padOscs[i];
      const target = PAD_ROOT * chord[i] * (frame.night > 0.5 ? 0.75 : 1);
      osc.frequency.rampTo(target, 4);
      const level = (i === 0 ? 0.16 : 0.085) * (0.55 + frame.mood * 0.45);
      this.padGains[i]?.gain.rampTo(dbFromUnit(level), 1.2);
    }

    // Cloud voices.
    const seen = new Set<string>();
    for (const input of frame.clouds) {
      seen.add(input.id);
      let voice: CloudVoice | null | undefined = this.voices.get(input.id);
      if (!voice) {
        voice = this.createVoice();
        if (!voice) return;
        this.voices.set(input.id, voice);
      }
      const round = Math.max(0, Math.min(1, input.roundness));
      const frequency = 620 - round * 470; // 620 Hz (thin) → 150 Hz (round)
      const type: "sine" | "triangle" = round > 0.5 ? "sine" : "triangle";
      voice.osc.type = type;
      voice.osc.frequency.rampTo(frequency, 0.9);
      voice.panner.pan.rampTo(Math.max(-1, Math.min(1, input.pan)), 0.5);
      voice.filter.frequency.rampTo(300 + round * 500 + input.density * 400, 0.8);
      const level = (0.02 + input.mass * 0.075) * (0.35 + input.density * 0.65) * (0.6 + frame.mood * 0.4);
      voice.gain.gain.rampTo(dbFromUnit(level), 0.6);
    }

    for (const [id, voice] of this.voices) {
      if (!seen.has(id)) {
        this.destroyVoice(voice);
        this.voices.delete(id);
      }
    }
  }

  private createVoice(): CloudVoice | null {
    const Tone = this.tone;
    if (!Tone || !this.master || !this.wet) return null;
    const osc = new Tone.Oscillator({ frequency: 220, type: "sine", volume: -Infinity });
    const filter = new Tone.Filter({ type: "lowpass", frequency: 700, Q: 0.7 });
    const panner = new Tone.Panner(0);
    const gain = new Tone.Gain(-Infinity);
    osc.connect(filter);
    filter.connect(panner);
    panner.connect(gain);
    gain.connect(this.master);
    gain.connect(this.wet);
    osc.start();
    return { osc, gain, panner, filter };
  }

  private destroyVoice(voice: CloudVoice): void {
    voice.gain.gain.rampTo(-80, 0.6);
    const osc = voice.osc;
    const gain = voice.gain;
    const panner = voice.panner;
    const filter = voice.filter;
    window.setTimeout(() => {
      try {
        osc.stop();
      } catch {
        /* already stopped */
      }
      osc.dispose();
      filter.dispose();
      panner.dispose();
      gain.dispose();
    }, 900);
  }

  /** Lightning → rolling thunder. */
  playThunder(intensity = 1): void {
    if (!this.ready || !this.enabled || !this.thunder) return;
    this.thunder.triggerAttackRelease(2.2, undefined, Math.min(1, intensity));
  }

  /** Soft feedback while sculpting: a breathy puff or a crisp fracture. */
  playSculpt(kind: "inflate" | "deflate" | "fracture" | "create"): void {
    const Tone = this.tone;
    if (!this.ready || !this.enabled || !Tone || !this.master || !this.wet) return;
    const now = Tone.now();
    if (kind === "fracture") {
      const noise = new Tone.NoiseSynth({
        noise: { type: "white" },
        envelope: { attack: 0.005, decay: 0.28, sustain: 0, release: 0.2 },
      });
      const filter = new Tone.Filter({ type: "highpass", frequency: 1800 });
      const gain = new Tone.Gain(-24);
      noise.connect(filter);
      filter.connect(gain);
      gain.connect(this.master);
      gain.connect(this.wet);
      noise.triggerAttackRelease(0.25, now);
      window.setTimeout(() => {
        noise.dispose();
        filter.dispose();
        gain.dispose();
      }, 900);
      return;
    }

    const frequencies = { inflate: 320, deflate: 210, create: 440, fracture: 300 } as const;
    const osc = new Tone.Oscillator({
      frequency: frequencies[kind],
      type: kind === "create" ? "triangle" : "sine",
    });
    const gain = new Tone.Gain(-Infinity);
    osc.connect(gain);
    gain.connect(this.master);
    gain.connect(this.wet);
    osc.start(now);
    gain.gain.setValueAtTime(-38, now);
    gain.gain.exponentialRampToValueAtTime(-16, now + 0.06);
    gain.gain.exponentialRampToValueAtTime(-70, now + 0.7);
    osc.stop(now + 0.8);
    window.setTimeout(() => {
      osc.dispose();
      gain.dispose();
    }, 1200);
  }

  dispose(): void {
    this.disposed = true;
    this.ready = false;
    for (const voice of this.voices.values()) {
      try {
        voice.osc.stop();
      } catch {
        /* noop */
      }
      voice.osc.dispose();
      voice.filter.dispose();
      voice.panner.dispose();
      voice.gain.dispose();
    }
    this.voices.clear();
    const nodes = [
      ...this.padOscs,
      ...this.padGains,
      ...this.padFilters,
      this.padLfo,
      this.windNoise,
      this.windFilter,
      this.windGain,
      this.windLfo,
      this.rainNoise,
      this.rainFilter,
      this.rainGain,
      this.thunder,
      this.thunderFilter,
      this.thunderGain,
      this.wet,
      this.reverb,
      this.master,
      this.limiter,
    ];
    for (const node of nodes) {
      if (!node) continue;
      try {
        (node as { stop?: () => void }).stop?.();
      } catch {
        /* noop */
      }
      (node as { dispose?: () => void }).dispose?.();
    }
    this.padOscs = [];
    this.padGains = [];
    this.padFilters = [];
    this.tone = null;
  }
}

export const audio = new AudioEngine();
