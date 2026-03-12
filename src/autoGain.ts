import * as Tone from 'tone'
import type { SequencerNodes } from 'tonejs-json-sequencer'
import { MONITOR_A_NODE_ID, MONITOR_B_NODE_ID, type Group } from './constants'
import { computeKWeightingCoeffs, getChannelWeight } from './lufs'

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

function analyzeAudioBuffer(buffer: AudioBuffer): LoudnessSnapshot {
  const channelCount = buffer.numberOfChannels
  if (channelCount <= 0 || buffer.length <= 0) {
    return { lufs: null, peak: null, blob: null }
  }

  const [stage0, stage1] = computeKWeightingCoeffs(buffer.sampleRate)
  let weightedPowerSum = 0
  let peak = 0

  for (let ch = 0; ch < channelCount; ch++) {
    const raw = buffer.getChannelData(ch)
    const weight = getChannelWeight(ch, channelCount)

    // Track true peak on the raw (unfiltered) signal
    for (let i = 0; i < raw.length; i++) {
      const abs = Math.abs(raw[i])
      if (abs > peak) peak = abs
    }

    if (weight === 0) {
      // Skip K-weighting and mean-square work for channels that do not contribute
      continue
    }

    // Apply K-weighting (two cascaded biquad stages) in a single pass
    let x1_0 = 0, x2_0 = 0, y1_0 = 0, y2_0 = 0
    let x1_1 = 0, x2_1 = 0, y1_1 = 0, y2_1 = 0

    let meanSquare = 0
    for (let i = 0; i < raw.length; i++) {
      const x = raw[i]

      // First biquad stage
      const out0 =
        stage0.b0 * x + stage0.b1 * x1_0 + stage0.b2 * x2_0 - stage0.a1 * y1_0 - stage0.a2 * y2_0
      x2_0 = x1_0
      x1_0 = x
      y2_0 = y1_0
      y1_0 = out0

      // Second biquad stage
      const out1 =
        stage1.b0 * out0 + stage1.b1 * x1_1 + stage1.b2 * x2_1 - stage1.a1 * y1_1 - stage1.a2 * y2_1
      x2_1 = x1_1
      x1_1 = out0
      y2_1 = y1_1
      y1_1 = out1

      meanSquare += out1 * out1
    }
    meanSquare /= raw.length

    weightedPowerSum += weight * meanSquare
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
