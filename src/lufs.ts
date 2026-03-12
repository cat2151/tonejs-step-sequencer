// ITU-R BS.1770-4 K-weighting DSP helpers (no Tone.js dependency)

export type BiquadCoeffs = { b0: number; b1: number; b2: number; a1: number; a2: number }

export function computeKWeightingCoeffs(sampleRate: number): [BiquadCoeffs, BiquadCoeffs] {
  // Stage 1: High-shelf pre-filter (models acoustic effect of the listener's head)
  const f1 = 1681.974450955533
  const G1 = 3.999843853973347
  const Q1 = 0.7071752369554196
  const K1 = Math.tan(Math.PI * (f1 / sampleRate))
  const Vh = Math.pow(10.0, G1 / 20.0)
  const Vb = Math.pow(10.0, G1 / 40.0) // = sqrt(Vh) via exponent identity: 10^(G1/40) = 10^(G1/20 * 1/2)
  const d1 = 1.0 + K1 / Q1 + K1 * K1
  const stage1: BiquadCoeffs = {
    b0: (Vh + (Vb * K1) / Q1 + K1 * K1) / d1,
    b1: (2.0 * (K1 * K1 - Vh)) / d1,
    b2: (Vh - (Vb * K1) / Q1 + K1 * K1) / d1,
    a1: (2.0 * (K1 * K1 - 1.0)) / d1,
    a2: (1.0 - K1 / Q1 + K1 * K1) / d1,
  }

  // Stage 2: High-pass (RLB) weighting filter
  const f2 = 38.13547087602444
  const Q2 = 0.5003270373238773
  const K2 = Math.tan(Math.PI * (f2 / sampleRate))
  const d2 = 1.0 + K2 / Q2 + K2 * K2
  const stage2: BiquadCoeffs = {
    b0: 1.0 / d2,
    b1: -2.0 / d2,
    b2: 1.0 / d2,
    a1: (2.0 * (K2 * K2 - 1.0)) / d2,
    a2: (1.0 - K2 / Q2 + K2 * K2) / d2,
  }

  return [stage1, stage2]
}

export function applyBiquad(input: Float32Array, c: BiquadCoeffs): Float32Array {
  const output = new Float32Array(input.length)
  let x1 = 0,
    x2 = 0,
    y1 = 0,
    y2 = 0
  for (let i = 0; i < input.length; i++) {
    const x0 = input[i]
    const y0 = c.b0 * x0 + c.b1 * x1 + c.b2 * x2 - c.a1 * y1 - c.a2 * y2
    x2 = x1
    x1 = x0
    y2 = y1
    y1 = y0
    output[i] = y0
  }
  return output
}

// ITU-R BS.1770 channel weights: 1.0 for L/R/C, 1.41 for surround channels
export function getChannelWeight(channelIndex: number, totalChannels: number): number {
  if (totalChannels === 6) {
    // L, R, C, LFE, Ls, Rs — LFE (channel 3) excluded (weight 0)
    return channelIndex === 3 ? 0 : channelIndex >= 4 ? 1.41 : 1.0
  }
  if (totalChannels === 4) {
    // L, R, Ls, Rs
    return channelIndex >= 2 ? 1.41 : 1.0
  }
  // mono / stereo / other: all channels have weight 1.0
  return 1.0
}
