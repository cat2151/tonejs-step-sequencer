import { describe, expect, it } from 'vitest'
import { computeKWeightingCoeffs, applyBiquad } from '../src/lufs'

// ITU-R BS.1770-4 reference coefficients for 48 kHz (from the standard)
// Stage 1 (high-shelf pre-filter): reference uses the same normalization as our implementation
const REF_48K_STAGE1_B = [1.53512485958697, -2.69169618940638, 1.19839281085285]
const REF_48K_STAGE1_A = [-1.69065929318241, 0.73248077421585]

// Number of decimal places used by toBeCloseTo for coefficient comparisons (1e-4 tolerance)
const COEFF_PRECISION = 4

/** Evaluate a biquad H(z) at a single frequency (angle in radians) and return magnitude. */
function biquadMagnitude(
  coeffs: { b0: number; b1: number; b2: number; a1: number; a2: number },
  omega: number,
): number {
  const cos1 = Math.cos(omega)
  const cos2 = Math.cos(2 * omega)
  const sin1 = Math.sin(omega)
  const sin2 = Math.sin(2 * omega)
  const bRe = coeffs.b0 + coeffs.b1 * cos1 + coeffs.b2 * cos2
  const bIm = -(coeffs.b1 * sin1 + coeffs.b2 * sin2)
  const aRe = 1.0 + coeffs.a1 * cos1 + coeffs.a2 * cos2
  const aIm = -(coeffs.a1 * sin1 + coeffs.a2 * sin2)
  const num = Math.sqrt(bRe * bRe + bIm * bIm)
  const den = Math.sqrt(aRe * aRe + aIm * aIm)
  return num / den
}

describe('computeKWeightingCoeffs', () => {
  it('produces stage-1 coefficients matching the ITU-R BS.1770-4 reference at 48 kHz', () => {
    const [stage1] = computeKWeightingCoeffs(48000)
    expect(stage1.b0).toBeCloseTo(REF_48K_STAGE1_B[0], COEFF_PRECISION)
    expect(stage1.b1).toBeCloseTo(REF_48K_STAGE1_B[1], COEFF_PRECISION)
    expect(stage1.b2).toBeCloseTo(REF_48K_STAGE1_B[2], COEFF_PRECISION)
    expect(stage1.a1).toBeCloseTo(REF_48K_STAGE1_A[0], COEFF_PRECISION)
    expect(stage1.a2).toBeCloseTo(REF_48K_STAGE1_A[1], COEFF_PRECISION)
  })

  it('stage-2 is a high-pass filter: passes high frequencies and attenuates low frequencies', () => {
    const [, stage2] = computeKWeightingCoeffs(48000)
    const sampleRate = 48000
    // 1 kHz should pass through (above the 38 Hz cutoff) — gain close to 1
    const omega1k = (2 * Math.PI * 1000) / sampleRate
    expect(biquadMagnitude(stage2, omega1k)).toBeCloseTo(1.0, 1)
    // 10 Hz should be heavily attenuated (below 38 Hz cutoff)
    const omega10 = (2 * Math.PI * 10) / sampleRate
    expect(biquadMagnitude(stage2, omega10)).toBeLessThan(0.1)
  })

  it('stage-2 normalized a-coefficients match the ITU-R BS.1770-4 reference at 48 kHz', () => {
    const [, stage2] = computeKWeightingCoeffs(48000)
    expect(stage2.a1).toBeCloseTo(-1.99004745483398, COEFF_PRECISION)
    expect(stage2.a2).toBeCloseTo(0.99007225036920, COEFF_PRECISION)
  })

  it('returns finite coefficients for common sample rates', () => {
    for (const sr of [22050, 44100, 48000, 96000]) {
      const [s1, s2] = computeKWeightingCoeffs(sr)
      for (const c of [s1, s2]) {
        expect(Number.isFinite(c.b0)).toBe(true)
        expect(Number.isFinite(c.b1)).toBe(true)
        expect(Number.isFinite(c.b2)).toBe(true)
        expect(Number.isFinite(c.a1)).toBe(true)
        expect(Number.isFinite(c.a2)).toBe(true)
      }
    }
  })
})

describe('applyBiquad', () => {
  it('passes an impulse through a unity-gain pass-through biquad (b=[1,0,0], a=[0,0]) unchanged', () => {
    const passThrough = { b0: 1, b1: 0, b2: 0, a1: 0, a2: 0 }
    const input = new Float32Array([1, 0, 0, 0, 0, 0, 0, 0])
    const output = applyBiquad(input, passThrough)
    expect(output[0]).toBeCloseTo(1)
    for (let i = 1; i < output.length; i++) {
      expect(output[i]).toBeCloseTo(0)
    }
  })

  it('returns an array of the same length as the input', () => {
    const coeffs = computeKWeightingCoeffs(48000)[0]
    const input = new Float32Array(128)
    const output = applyBiquad(input, coeffs)
    expect(output.length).toBe(128)
  })

  it('outputs zero for a zero-signal input', () => {
    const [s1] = computeKWeightingCoeffs(48000)
    const input = new Float32Array(64)
    const output = applyBiquad(input, s1)
    for (let i = 0; i < output.length; i++) {
      expect(output[i]).toBeCloseTo(0)
    }
  })

  it('high-pass stage attenuates a DC signal (approaching zero output)', () => {
    // Stage 2 is a high-pass filter — a sustained DC signal should be attenuated
    const [, hpf] = computeKWeightingCoeffs(48000)
    const n = 4096
    const input = new Float32Array(n).fill(1.0)
    const output = applyBiquad(input, hpf)
    // After a long DC input the steady-state output should be very close to zero
    const lastSample = output[n - 1]
    expect(Math.abs(lastSample)).toBeLessThan(0.01)
  })
})
