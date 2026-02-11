import * as Tone from 'tone'
import {
  FFT_NORMALIZATION_OFFSET,
  MAX_WAVEFORM_GAIN,
  MIN_STANDARD_DEVIATION,
  WAVEFORM_BUFFER_MAX,
  WAVEFORM_BUFFER_MIN,
  WAVEFORM_SILENCE_THRESHOLD,
  type Group,
} from './constants'
import { getGroupMinFrequency } from './noteGrid'

export type CanvasSize = { width: number; height: number }

type WaveformWindow = { prevSegment: Float32Array | null; windowLength: number; prevStart: number }
type WaveformGain = { gain: number; framesSincePeak: number }
type WaveformRing = { buffer: Float32Array; writeIndex: number; filled: number }

export type WaveformWindowState = Record<Group, WaveformWindow>
export type WaveformGainState = Record<Group, WaveformGain>
export type WaveformRingState = Record<Group, WaveformRing>

export type WaveformState = {
  windows: WaveformWindowState
  gains: WaveformGainState
  rings: WaveformRingState
}

export function createWaveformState(): WaveformState {
  return {
    windows: {
      A: { prevSegment: null, windowLength: 0, prevStart: 0 },
      B: { prevSegment: null, windowLength: 0, prevStart: 0 },
    },
    gains: {
      A: { gain: 1, framesSincePeak: 0 },
      B: { gain: 1, framesSincePeak: 0 },
    },
    rings: {
      A: { buffer: new Float32Array(WAVEFORM_BUFFER_MAX), writeIndex: 0, filled: 0 },
      B: { buffer: new Float32Array(WAVEFORM_BUFFER_MAX), writeIndex: 0, filled: 0 },
    },
  }
}

export function resetWaveformWindows(state: WaveformState) {
  state.windows.A.prevSegment = null
  state.windows.B.prevSegment = null
  state.windows.A.prevStart = 0
  state.windows.B.prevStart = 0
}

export function resetWaveformGains(state: WaveformState) {
  state.gains.A.gain = 1
  state.gains.B.gain = 1
  state.gains.A.framesSincePeak = 0
  state.gains.B.framesSincePeak = 0
}

function calculateCycleSamples(group: Group) {
  const minFrequency = Math.max(getGroupMinFrequency(group), 1)
  const sampleRate = Tone.getContext().sampleRate || 44100
  return Math.max(Math.round(sampleRate / minFrequency), 1)
}

function calculateWaveformBufferSize(windowLength: number) {
  const desired = Math.min(WAVEFORM_BUFFER_MAX, Math.max(WAVEFORM_BUFFER_MIN, windowLength * 2))
  return 2 ** Math.ceil(Math.log2(desired))
}

function ensureWaveformBuffer(analyser: Tone.Analyser, windowLength: number) {
  const MAX_ANALYSER_SIZE = 32768
  const targetSize = Math.min(calculateWaveformBufferSize(windowLength), MAX_ANALYSER_SIZE)
  if (analyser.size !== targetSize) {
    analyser.size = targetSize
  }
}

function writeRingBuffer(state: WaveformState, group: Group, frame: Float32Array) {
  const ring = state.rings[group]
  const { buffer } = ring
  let writeIndex = ring.writeIndex
  for (let i = 0; i < frame.length; i++) {
    buffer[writeIndex] = frame[i]
    writeIndex += 1
    if (writeIndex >= buffer.length) {
      writeIndex = 0
    }
  }
  ring.writeIndex = writeIndex
  ring.filled = Math.min(buffer.length, ring.filled + frame.length)
}

function readRingBuffer(state: WaveformState, group: Group, length: number) {
  const ring = state.rings[group]
  const { buffer } = ring
  const available = Math.min(length, ring.filled, buffer.length)
  if (available <= 0) {
    return new Float32Array(0)
  }
  const result = new Float32Array(available)
  const start = (ring.writeIndex - available + buffer.length) % buffer.length
  const firstChunk = Math.min(available, buffer.length - start)
  result.set(buffer.subarray(start, start + firstChunk), 0)
  if (firstChunk < available) {
    result.set(buffer.subarray(0, available - firstChunk), firstChunk)
  }
  return result
}

function calculateWindowSamples(cycleLength: number) {
  return Math.max(cycleLength * 4, 1)
}

function findBestCorrelationStart(
  values: Float32Array,
  reference: Float32Array,
  windowLength: number,
  centerStart: number,
  startMax: number,
  maxIterations: number,
  startMin = 0,
) {
  const clampedStartMax = Math.min(startMax, values.length - windowLength)
  if (clampedStartMax <= 0) return 0

  const SCORE_EPSILON = 1e-4
  let refSum = 0
  let refSqSum = 0
  for (let i = 0; i < windowLength; i++) {
    const refSample = reference[i]
    refSum += refSample
    refSqSum += refSample * refSample
  }
  const refMean = refSum / windowLength
  const refVariance = Math.max(refSqSum / windowLength - refMean * refMean, 0)
  const refStd = Math.max(Math.sqrt(refVariance), MIN_STANDARD_DEVIATION)

  const totalCandidates = clampedStartMax - startMin + 1
  const iterationBudget = Math.max(1, Math.min(maxIterations, totalCandidates))
  const candidates: number[] = []
  if (iterationBudget === 1) {
    candidates.push(Math.max(startMin, Math.min(centerStart, clampedStartMax)))
  } else {
    const span = clampedStartMax - startMin
    for (let i = 0; i < iterationBudget; i++) {
      const ratio = i / (iterationBudget - 1)
      const start = Math.round(startMin + span * ratio)
      if (candidates.length === 0 || candidates[candidates.length - 1] !== start) {
        candidates.push(start)
      }
    }
  }

  let bestScore = -Infinity
  let bestStart = 0
  let bestDistance = Infinity

  for (const start of candidates) {
    let windowSum = 0
    let windowSqSum = 0
    let dotProduct = 0
    let idx = start
    for (let i = 0; i < windowLength; i++, idx++) {
      const sample = values[idx]
      windowSum += sample
      windowSqSum += sample * sample
      dotProduct += sample * reference[i]
    }

    const windowMean = windowSum / windowLength
    const windowVariance = Math.max(windowSqSum / windowLength - windowMean * windowMean, 0)
    const windowStd = Math.max(Math.sqrt(windowVariance), MIN_STANDARD_DEVIATION)

    const numerator = dotProduct - windowLength * windowMean * refMean
    const denominator = windowLength * windowStd * refStd
    const score = denominator > 0 ? numerator / denominator : -Infinity
    const distance = Math.abs(start - centerStart)

    if (score > bestScore + SCORE_EPSILON) {
      bestScore = score
      bestStart = start
      bestDistance = distance
    } else if (Math.abs(score - bestScore) <= SCORE_EPSILON && distance < bestDistance) {
      bestStart = start
      bestDistance = distance
    }
  }

  return bestStart
}

function selectWaveformSegment(
  state: WaveformState,
  group: Group,
  waveformValues: Float32Array,
  windowLength: number,
  cycleLength: number,
  maxIterations: number,
) {
  const effectiveWindow = Math.min(windowLength, waveformValues.length)
  const windowState = state.windows[group]

  if (windowState.windowLength !== effectiveWindow) {
    windowState.windowLength = effectiveWindow
    windowState.prevSegment = null
    windowState.prevStart = 0
  }

  const maxStart = Math.max(0, waveformValues.length - effectiveWindow)
  const searchSpan = Math.min(maxStart, Math.max(Math.floor(cycleLength / 2), 1))
  const startMin = Math.max(0, maxStart - searchSpan)
  const startMax = maxStart
  let startIndex = startMax

  if (windowState.prevSegment && windowState.prevSegment.length === effectiveWindow && startMax > startMin) {
    const centerStart = Math.max(startMin, Math.min(windowState.prevStart, startMax))
    startIndex = findBestCorrelationStart(
      waveformValues,
      windowState.prevSegment,
      effectiveWindow,
      centerStart,
      startMax,
      maxIterations,
      startMin,
    )
  }

  const segment = waveformValues.slice(startIndex, startIndex + effectiveWindow)
  windowState.prevSegment = segment
  windowState.prevStart = startIndex
  return segment
}

export function drawGroupVisuals(
  group: Group,
  waveformState: WaveformState,
  waveformAnalyser: Tone.Analyser,
  fftAnalyser: Tone.Analyser,
  waveformCtx: CanvasRenderingContext2D,
  waveformCanvas: HTMLCanvasElement,
  waveformSize: CanvasSize,
  fftCtx: CanvasRenderingContext2D,
  fftCanvas: HTMLCanvasElement,
  fftSize: CanvasSize,
): { waveformMs: number; fftMs: number } {
  const waveformStart = performance.now()
  const cycleLength = calculateCycleSamples(group)
  const targetWindowLength = calculateWindowSamples(cycleLength)
  ensureWaveformBuffer(waveformAnalyser, targetWindowLength)
  const latestFrame = waveformAnalyser.getValue() as Float32Array
  writeRingBuffer(waveformState, group, latestFrame)
  const desiredBufferLength = Math.min(WAVEFORM_BUFFER_MAX, targetWindowLength + cycleLength)
  let waveformValues: Float32Array
  if (desiredBufferLength <= latestFrame.length) {
    const offset = latestFrame.length - desiredBufferLength
    waveformValues = offset > 0 ? latestFrame.subarray(offset) : latestFrame
  } else {
    waveformValues = readRingBuffer(waveformState, group, desiredBufferLength)
  }
  const availableCycles = waveformValues.length / Math.max(cycleLength, 1)
  const displayCycles =
    availableCycles >= 4
      ? 4
      : availableCycles >= 3
        ? 3
        : availableCycles >= 2
          ? 2
          : availableCycles >= 1
            ? 1
            : availableCycles >= 0.5
              ? 0.5
              : availableCycles
  const windowLength = Math.min(waveformValues.length, Math.max(Math.round(displayCycles * cycleLength), 1))
  const waveformWidth = waveformSize.width || waveformCanvas.width
  const searchIterations = Math.max(1, Math.min(waveformWidth > 0 ? Math.round(waveformWidth) : 400, 400))
  const waveformSegment = selectWaveformSegment(
    waveformState,
    group,
    waveformValues,
    windowLength,
    cycleLength,
    searchIterations,
  )
  const waveformData = waveformSegment.length ? waveformSegment : waveformValues
  const gainState = waveformState.gains[group]
  let maxAbs = 0
  for (let i = 0; i < waveformData.length; i++) {
    const abs = Math.abs(waveformData[i])
    if (abs > maxAbs) {
      maxAbs = abs
      if (maxAbs >= 1) {
        break
      }
    }
  }
  let gain = gainState.gain
  let scaledMax = maxAbs * gain

  if (scaledMax > 1) {
    gain = 1 / Math.max(maxAbs, MIN_STANDARD_DEVIATION)
    gainState.framesSincePeak = 0
  } else if (scaledMax >= 0.98) {
    gainState.framesSincePeak = 0
  } else if (maxAbs < WAVEFORM_SILENCE_THRESHOLD) {
    gainState.framesSincePeak = 0
  } else {
    gainState.framesSincePeak += 1
    if (gainState.framesSincePeak >= 30) {
      gain *= 1.01
      scaledMax = maxAbs * gain
      if (scaledMax > 1) {
        gain = 1 / Math.max(maxAbs, MIN_STANDARD_DEVIATION)
        gainState.framesSincePeak = 0
      }
    }
  }
  if (!Number.isFinite(gain) || gain <= 0) {
    gain = 1
  }
  gainState.gain = Math.min(gain, MAX_WAVEFORM_GAIN)
  const appliedGain = gainState.gain
  const waveformHeight = waveformSize.height || waveformCanvas.height

  waveformCtx.fillStyle = '#0b1221'
  waveformCtx.fillRect(0, 0, waveformWidth, waveformHeight)
  waveformCtx.strokeStyle = '#7cf2c2'
  waveformCtx.lineWidth = 2
  waveformCtx.beginPath()
  const waveformLength = Math.max(waveformData.length - 1, 1)
  for (let index = 0; index < waveformData.length; index++) {
    const value = Math.max(Math.min(waveformData[index] * appliedGain, 1), -1)
    const x = (index / waveformLength) * waveformWidth
    const y = (1 - (value + 1) / 2) * waveformHeight
    if (index === 0) {
      waveformCtx.moveTo(x, y)
    } else {
      waveformCtx.lineTo(x, y)
    }
  }
  waveformCtx.stroke()
  if (displayCycles < 4) {
    waveformCtx.fillStyle = 'rgba(124, 242, 194, 0.85)'
    waveformCtx.font = '12px "JetBrains Mono", monospace'
    waveformCtx.textBaseline = 'top'
    waveformCtx.fillText(displayCycles.toString(), 8, 6)
  }

  const waveformMs = performance.now() - waveformStart

  const fftStart = performance.now()
  const fftWidth = fftSize.width || fftCanvas.width
  const fftHeight = fftSize.height || fftCanvas.height
  const fftValues = fftAnalyser.getValue() as Float32Array

  fftCtx.fillStyle = '#0b1221'
  fftCtx.fillRect(0, 0, fftWidth, fftHeight)
  fftCtx.fillStyle = '#5dbbff'
  const barWidth = fftWidth / fftValues.length
  fftValues.forEach((value, index) => {
    const magnitude = Math.max((value + FFT_NORMALIZATION_OFFSET) / FFT_NORMALIZATION_OFFSET, 0)
    const barHeight = magnitude * fftHeight
    const x = index * barWidth
    const y = fftHeight - barHeight
    fftCtx.fillRect(x, y, barWidth - 1, barHeight)
  })

  const fftMs = performance.now() - fftStart

  return { waveformMs, fftMs }
}
