import * as Tone from 'tone'
import type { SequencerNodes } from 'tonejs-json-sequencer'
import { MONITOR_A_NODE_ID, MONITOR_B_NODE_ID, type Group } from './constants'

export type LoudnessSnapshot = {
  rms: number | null
  peak: number | null
  loudnessDb: number | null
  blob: Blob | null
}

type GroupSnapshots = Record<Group, LoudnessSnapshot>

const MIN_RMS = 1e-6
const MIN_DURATION = 0.1
const MIN_AUTO_GAIN = 0.1
const MAX_AUTO_GAIN = 4
const TARGET_RMS_CAP = 0.35

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

function analyzeAudioBuffer(buffer: AudioBuffer): LoudnessSnapshot {
  const channelCount = buffer.numberOfChannels
  if (channelCount <= 0 || buffer.length <= 0) {
    return { rms: null, peak: null, loudnessDb: null, blob: null }
  }

  let sum = 0
  let peak = 0
  for (let channel = 0; channel < channelCount; channel++) {
    const data = buffer.getChannelData(channel)
    for (let i = 0; i < data.length; i++) {
      const value = data[i]
      sum += value * value
      const abs = Math.abs(value)
      if (abs > peak) {
        peak = abs
      }
    }
  }

  const totalSamples = buffer.length * channelCount
  const rms = totalSamples > 0 ? Math.sqrt(sum / totalSamples) : 0
  const normalizedRms = rms > MIN_RMS ? rms : null
  const loudnessDb = normalizedRms ? 20 * Math.log10(normalizedRms) : null

  return {
    rms: normalizedRms,
    peak: peak > MIN_RMS ? peak : null,
    loudnessDb,
    blob: null,
  }
}

async function recordLoop(nodes: SequencerNodes, group: Group, durationSeconds: number): Promise<LoudnessSnapshot> {
  if (!Tone.Recorder.supported) {
    return { rms: null, peak: null, loudnessDb: null, blob: null }
  }

  const nodeId = group === 'A' ? MONITOR_A_NODE_ID : MONITOR_B_NODE_ID
  const monitorBus = nodes.get(nodeId)
  if (!(monitorBus instanceof Tone.Gain)) {
    return { rms: null, peak: null, loudnessDb: null, blob: null }
  }

  const recorder = new Tone.Recorder()
  monitorBus.connect(recorder)

  try {
    await recorder.start()
  } catch (error) {
    monitorBus.disconnect(recorder)
    recorder.dispose()
    console.warn('Failed to start recorder for auto gain', error)
    return { rms: null, peak: null, loudnessDb: null, blob: null }
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
    return { rms: null, peak: null, loudnessDb: null, blob }
  }

  try {
    const arrayBuffer = await blob.arrayBuffer()
    const audioBuffer = await Tone.getContext().rawContext.decodeAudioData(arrayBuffer)
    const analysis = analyzeAudioBuffer(audioBuffer)
    return { ...analysis, blob }
  } catch (error) {
    console.warn('Failed to decode recorded loop for loudness', error)
    return { rms: null, peak: null, loudnessDb: null, blob }
  }
}

function computeAutoGains(aRms: number | null, bRms: number | null): Record<Group, number> {
  const validRms = [aRms, bRms].filter((value): value is number => typeof value === 'number' && value > MIN_RMS)
  if (!validRms.length) {
    return { A: 1, B: 1 }
  }

  const logMean = validRms.reduce((sum, value) => sum + Math.log(value), 0) / validRms.length
  const targetRms = clamp(Math.exp(logMean), MIN_RMS, TARGET_RMS_CAP)

  const normalize = (value: number | null) => {
    if (!value || value <= MIN_RMS) {
      return 1
    }
    return clamp(targetRms / value, MIN_AUTO_GAIN, MAX_AUTO_GAIN)
  }

  return { A: normalize(aRms), B: normalize(bRms) }
}

export function createAutoGainManager(nodes: SequencerNodes) {
  let measurements: GroupSnapshots = {
    A: { rms: null, peak: null, loudnessDb: null, blob: null },
    B: { rms: null, peak: null, loudnessDb: null, blob: null },
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
    autoGains = computeAutoGains(a.rms, b.rms)
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
