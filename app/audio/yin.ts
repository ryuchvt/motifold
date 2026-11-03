// Written for Phrasepath during the event (10-27), from ENGINE-SPEC and the YIN paper, and carried here as it was.
// Pitch, frame by frame: YIN (de Cheveigné and Kawahara, 2002), as ENGINE-SPEC step 1 describes.
// The difference function is computed directly over the lags that matter (55 Hz and up), on audio
// first brought down to about 20–24 kHz. Window, hop and the search range stay in ms and Hz.

export interface PitchFrame {
  /** Centre of the samples YIN compared, in seconds from the start of the input. */
  timeSec: number;
  /** Null when the frame has no usable period (silence). */
  hz: number | null;
  /** The cumulative mean normalised difference at the chosen lag: 0 is perfectly periodic. */
  aperiodicity: number;
  /** RMS of the original-rate signal over ±6 ms at `timeSec` (ENGINE-SPEC step 2). */
  rms: number;
}

export interface YinOptions {
  threshold?: number;
  windowMs?: number;
  hopMs?: number;
  minHz?: number;
  maxHz?: number;
  /** Below this rate nothing is downsampled. */
  minPitchRate?: number;
}

export interface PitchTrack {
  frames: PitchFrame[];
  hopSec: number;
  /** Duration of the window YIN looks at, in seconds. */
  windowSec: number;
}

/** Low-pass and keep every `factor`th sample. Windowed-sinc FIR, centred, so nothing shifts in time. */
export function decimate(samples: Float32Array, sampleRate: number, minRate = 20000): { samples: Float32Array; sampleRate: number } {
  const factor = Math.max(1, Math.floor(sampleRate / minRate));
  if (factor === 1) return { samples, sampleRate };
  const taps = 63;
  const half = (taps - 1) / 2;
  const cutoff = 0.45 / factor; // cycles per input sample: 90% of the new Nyquist
  const kernel = new Float64Array(taps);
  let sum = 0;
  for (let k = 0; k < taps; k++) {
    const n = k - half;
    const sinc = n === 0 ? 2 * cutoff : Math.sin(2 * Math.PI * cutoff * n) / (Math.PI * n);
    const blackman = 0.42 - 0.5 * Math.cos((2 * Math.PI * k) / (taps - 1)) + 0.08 * Math.cos((4 * Math.PI * k) / (taps - 1));
    kernel[k] = sinc * blackman;
    sum += kernel[k]!;
  }
  for (let k = 0; k < taps; k++) kernel[k]! /= sum;

  const outLength = Math.floor(samples.length / factor);
  const out = new Float32Array(outLength);
  for (let m = 0; m < outLength; m++) {
    const centre = m * factor;
    let acc = 0;
    const from = Math.max(0, half - centre);
    const to = Math.min(taps, samples.length - centre + half);
    for (let k = from; k < to; k++) acc += kernel[k]! * samples[centre + k - half]!;
    out[m] = acc;
  }
  return { samples: out, sampleRate: sampleRate / factor };
}

function nextPowerOfTwo(n: number): number {
  return 2 ** Math.ceil(Math.log2(n));
}

/** RMS over ±halfWidth samples around a centre sample. */
function rmsAround(samples: Float32Array, centre: number, halfWidth: number): number {
  const from = Math.max(0, Math.round(centre - halfWidth));
  const to = Math.min(samples.length, Math.round(centre + halfWidth) + 1);
  if (to <= from) return 0;
  let acc = 0;
  for (let i = from; i < to; i++) acc += samples[i]! * samples[i]!;
  return Math.sqrt(acc / (to - from));
}

/** How far the tracker listens when it isn't told otherwise. */
export const PITCH_RANGE = { minHz: 55, maxHz: 2000 };

export function yin(input: Float32Array, inputRate: number, options: YinOptions = {}): PitchTrack {
  const { threshold = 0.15, windowMs = 85, hopMs = 10, minHz = PITCH_RANGE.minHz, maxHz = PITCH_RANGE.maxHz, minPitchRate = 20000 } = options;
  const { samples: x, sampleRate: sr } = decimate(input, inputRate, minPitchRate);

  // The power of two holding the window; YIN compares its first half with lagged copies.
  const window = nextPowerOfTwo((windowMs / 1000) * sr);
  const half = window / 2;
  const hop = Math.max(1, Math.round((hopMs / 1000) * sr));
  const tauMax = Math.min(half - 2, Math.ceil(sr / minHz));
  const tauMin = Math.max(2, Math.floor(sr / maxHz));
  const levelHalfWidth = 0.006 * inputRate;

  const d = new Float64Array(tauMax + 2);
  const cmnd = new Float64Array(tauMax + 2);
  const frames: PitchFrame[] = [];

  for (let start = 0; start + half + tauMax + 1 <= x.length; start += hop) {
    let energy = 0;
    for (let j = 0; j < half; j++) energy += x[start + j]! * x[start + j]!;

    let tauFound = -1;
    if (energy > 1e-10) {
      // Difference function, then its cumulative mean normalised form.
      d[0] = 0;
      cmnd[0] = 1;
      let running = 0;
      for (let tau = 1; tau <= tauMax + 1; tau++) {
        let acc = 0;
        for (let j = 0; j < half; j++) {
          const diff = x[start + j]! - x[start + j + tau]!;
          acc += diff * diff;
        }
        d[tau] = acc;
        running += acc;
        cmnd[tau] = running > 0 ? (acc * tau) / running : 1;
      }
      // Absolute threshold: the first dip under it, followed down to its bottom.
      for (let tau = tauMin; tau <= tauMax; tau++) {
        if (cmnd[tau]! < threshold) {
          while (tau + 1 <= tauMax && cmnd[tau + 1]! < cmnd[tau]!) tau++;
          tauFound = tau;
          break;
        }
      }
      if (tauFound < 0) {
        let best = tauMin;
        for (let tau = tauMin + 1; tau <= tauMax; tau++) if (cmnd[tau]! < cmnd[best]!) best = tau;
        tauFound = best;
      }
    }

    if (tauFound < 0) {
      const centre = start + half / 2;
      frames.push({ timeSec: centre / sr, hz: null, aperiodicity: 1, rms: rmsAround(input, (centre / sr) * inputRate, levelHalfWidth) });
      continue;
    }

    // Parabolic interpolation around the chosen lag.
    let tau = tauFound;
    const a = cmnd[tauFound - 1]!;
    const b = cmnd[tauFound]!;
    const c = cmnd[tauFound + 1]!;
    const denominator = a - 2 * b + c;
    if (tauFound > 1 && denominator > 0) tau = tauFound + (a - c) / (2 * denominator);

    // Stamp the frame at the centre of the samples compared: start .. start + half + tau.
    const centre = start + (half + tau) / 2;
    frames.push({
      timeSec: centre / sr,
      hz: sr / tau,
      aperiodicity: b,
      rms: rmsAround(input, (centre / sr) * inputRate, levelHalfWidth),
    });
  }
  return { frames, hopSec: hop / sr, windowSec: window / sr };
}
