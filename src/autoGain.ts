import * as Tone from 'tone'
import type { SequencerNodes } from 'tonejs-json-sequencer'
import { MONITOR_A_NODE_ID, MONITOR_B_NODE_ID, type Group } from './constants'

export type LoudnessSnapshot = {
  lufs: number | null
  peak: number | null
  blob: Blob | null
}

type GroupSnapshots = Record<Group, LoudnessSnapshot>

const MIN_POWER = 1e-10
const MIN_PEAK = 1e-6
export const MIN_DURATION = 0.1
const MIN_AUTO_GAIN = 0.1
const MAX_AUTO_GAIN = 4
// Maximum target LUFS to prevent over-amplification (≈ equivalent of TARGET_RMS_CAP = 0.35)
const TARGET_LUFS_CAP = -9

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

// ITU-R BS.1770-4 K-weighting filter coefficients
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
    b0: (Vh + Vb * K1 / Q1 + K1 * K1) / d1,
    b1: 2.0 * (K1 * K1 - Vh) / d1,
    b2: (Vh - Vb * K1 / Q1 + K1 * K1) / d1,
    a1: 2.0 * (K1 * K1 - 1.0) / d1,
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
    a1: 2.0 * (K2 * K2 - 1.0) / d2,
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
function getChannelWeight(channelIndex: number, totalChannels: number): number {
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

function analyzeAudioBuffer(buffer: AudioBuffer): LoudnessSnapshot {
  const channelCount = buffer.numberOfChannels
  if (channelCount <= 0 || buffer.length <= 0) {
    return { lufs: null, peak: null, blob: null }
  }

  const coeffs = computeKWeightingCoeffs(buffer.sampleRate)
  let weightedPowerSum = 0
  let peak = 0

  for (let ch = 0; ch < channelCount; ch++) {
    const raw = buffer.getChannelData(ch)

    // Track true peak on the raw (unfiltered) signal
    for (let i = 0; i < raw.length; i++) {
      const abs = Math.abs(raw[i])
      if (abs > peak) peak = abs
    }

    // Apply K-weighting (two cascaded biquad stages)
    const kWeighted = applyBiquad(applyBiquad(raw, coeffs[0]), coeffs[1])

    // Mean square of K-weighted signal
    let meanSquare = 0
    for (let i = 0; i < kWeighted.length; i++) {
      meanSquare += kWeighted[i] * kWeighted[i]
    }
    meanSquare /= kWeighted.length

    weightedPowerSum += getChannelWeight(ch, channelCount) * meanSquare
  }

  // ITU-R BS.1770: LUFS = -0.691 + 10 * log10(sum of weighted mean squares)
  const lufs = weightedPowerSum > MIN_POWER ? -0.691 + 10 * Math.log10(weightedPowerSum) : null

  return {
    lufs,
    peak: peak > MIN_PEAK ? peak : null,
    blob: null,
  }
}

async function recordLoop(nodes: SequencerNodes, group: Group, durationSeconds: number): Promise<LoudnessSnapshot> {
  if (!Tone.Recorder.supported) {
    return { lufs: null, peak: null, blob: null }
  }

  const nodeId = group === 'A' ? MONITOR_A_NODE_ID : MONITOR_B_NODE_ID
  const monitorBus = nodes.get(nodeId)
  if (!(monitorBus instanceof Tone.Gain)) {
    return { lufs: null, peak: null, blob: null }
  }

  const recorder = new Tone.Recorder()
  monitorBus.connect(recorder)

  try {
    await recorder.start()
  } catch (error) {
    monitorBus.disconnect(recorder)
    recorder.dispose()
    console.warn('Failed to start recorder for auto gain', error)
    return { lufs: null, peak: null, blob: null }
  }

  const durationMs = Math.max(durationSeconds, MIN_DURATION) * 1000
  const failSafeMs = durationMs + 2000

  let blob: Blob | null = null
  try {
    blob = await new Promise<Blob>((resolve) => {
      const failSafe = window.setTimeout(() => {
        console.warn('Recorder stop timed out; returning empty blob for auto gain')
        resolve(new Blob())
      }, failSafeMs)
      window.setTimeout(async () => {
        try {
          resolve(await recorder.stop())
        } catch (error) {
          console.warn('Failed to stop recorder for auto gain', error)
          resolve(new Blob())
        } finally {
          window.clearTimeout(failSafe)
        }
      }, durationMs)
    })
  } finally {
    monitorBus.disconnect(recorder)
    recorder.dispose()
  }

  if (!blob || blob.size <= 0) {
    return { lufs: null, peak: null, blob }
  }

  try {
    const arrayBuffer = await blob.arrayBuffer()
    const audioBuffer = await Tone.getContext().rawContext.decodeAudioData(arrayBuffer)
    const analysis = analyzeAudioBuffer(audioBuffer)
    return { ...analysis, blob }
  } catch (error) {
    console.warn('Failed to decode recorded loop for loudness', error)
    return { lufs: null, peak: null, blob }
  }
}

function computeAutoGains(aLufs: number | null, bLufs: number | null): Record<Group, number> {
  const validLufs = [aLufs, bLufs].filter((v): v is number => typeof v === 'number' && Number.isFinite(v))
  if (!validLufs.length) {
    return { A: 1, B: 1 }
  }

  // Compute target as arithmetic mean in LUFS domain, capped to avoid over-amplification
  const meanLufs = validLufs.reduce((sum, v) => sum + v, 0) / validLufs.length
  const targetLufs = Math.min(meanLufs, TARGET_LUFS_CAP)

  const normalize = (lufs: number | null) => {
    if (lufs === null || !Number.isFinite(lufs)) {
      return 1
    }
    // gain (linear) = 10^((targetLufs - currentLufs) / 20)
    return clamp(Math.pow(10, (targetLufs - lufs) / 20), MIN_AUTO_GAIN, MAX_AUTO_GAIN)
  }

  return { A: normalize(aLufs), B: normalize(bLufs) }
}

export function createAutoGainManager(nodes: SequencerNodes) {
  let measurements: GroupSnapshots = {
    A: { lufs: null, peak: null, blob: null },
    B: { lufs: null, peak: null, blob: null },
  }
  let autoGains: Record<Group, number> = { A: 1, B: 1 }
  let measurementPromise: Promise<Record<Group, number>> | null = null
  let queuedDuration: number | null = null

  async function runMeasurement(durationSeconds: number) {
    const [a, b] = await Promise.all([
      recordLoop(nodes, 'A', durationSeconds),
      recordLoop(nodes, 'B', durationSeconds),
    ])
    measurements = { A: a, B: b }
    autoGains = computeAutoGains(a.lufs, b.lufs)
    return autoGains
  }

  async function measure(durationSeconds: number): Promise<Record<Group, number>> {
    if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
      return autoGains
    }
    if (measurementPromise) {
      queuedDuration = durationSeconds
      return measurementPromise.then(() => measure(durationSeconds))
    }

    measurementPromise = runMeasurement(durationSeconds)
      .catch((error) => {
        console.warn('Failed to measure loudness for auto gain', error)
        return autoGains
      })
      .finally(() => {
        const nextDuration = queuedDuration
        measurementPromise = null
        queuedDuration = null
        if (nextDuration !== null) {
          void measure(nextDuration)
        }
      })
    return measurementPromise
  }

  return {
    measure,
    getAutoGains() {
      return autoGains
    },
    getSnapshots() {
      return measurements
    },
  }
}
