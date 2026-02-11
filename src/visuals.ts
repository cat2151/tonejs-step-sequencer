import * as Tone from 'tone'
import type { SequencerNodes } from 'tonejs-json-sequencer'
import {
  FFT_NORMALIZATION_OFFSET,
  MAX_WAVEFORM_GAIN,
  MIN_STANDARD_DEVIATION,
  MONITOR_A_NODE_ID,
  MONITOR_B_NODE_ID,
  WAVEFORM_BUFFER_MAX,
  WAVEFORM_BUFFER_MIN,
  WAVEFORM_SILENCE_THRESHOLD,
  type Group,
} from './constants'
import { getGroupMinFrequency } from './noteGrid'

type CanvasSize = { width: number; height: number }

export function createVisuals(nodes: SequencerNodes) {
  const waveformCanvasA = document.querySelector<HTMLCanvasElement>('#waveform-a')
  const fftCanvasA = document.querySelector<HTMLCanvasElement>('#fft-a')
  const waveformCanvasB = document.querySelector<HTMLCanvasElement>('#waveform-b')
  const fftCanvasB = document.querySelector<HTMLCanvasElement>('#fft-b')
  const waveformCtxA = waveformCanvasA?.getContext('2d')
  const fftCtxA = fftCanvasA?.getContext('2d')
  const waveformCtxB = waveformCanvasB?.getContext('2d')
  const fftCtxB = fftCanvasB?.getContext('2d')
  const waveformTimeA = document.querySelector<HTMLElement>('#waveform-a-time')
  const fftTimeA = document.querySelector<HTMLElement>('#fft-a-time')
  const waveformTimeB = document.querySelector<HTMLElement>('#waveform-b-time')
  const fftTimeB = document.querySelector<HTMLElement>('#fft-b-time')

  const waveformAnalyserA = new Tone.Analyser('waveform', WAVEFORM_BUFFER_MIN)
  const fftAnalyserA = new Tone.Analyser('fft', 128)
  const waveformAnalyserB = new Tone.Analyser('waveform', WAVEFORM_BUFFER_MIN)
  const fftAnalyserB = new Tone.Analyser('fft', 128)

  let waveformSizeA: CanvasSize = { width: 0, height: 0 }
  let fftSizeA: CanvasSize = { width: 0, height: 0 }
  let waveformSizeB: CanvasSize = { width: 0, height: 0 }
  let fftSizeB: CanvasSize = { width: 0, height: 0 }
  let resizeTimeoutId: number | null = null
  let monitorBusA: Tone.Gain | null = null
  let monitorBusB: Tone.Gain | null = null
  let animationFrameId: number | null = null
  const waveformWindowState: Record<Group, { prevSegment: Float32Array | null; windowLength: number; prevStart: number }> = {
    A: { prevSegment: null, windowLength: 0, prevStart: 0 },
    B: { prevSegment: null, windowLength: 0, prevStart: 0 },
  }
  const waveformGainState: Record<Group, { gain: number; framesSincePeak: number }> = {
    A: { gain: 1, framesSincePeak: 0 },
    B: { gain: 1, framesSincePeak: 0 },
  }
  const waveformRingState: Record<Group, { buffer: Float32Array; writeIndex: number; filled: number }> = {
    A: { buffer: new Float32Array(WAVEFORM_BUFFER_MAX), writeIndex: 0, filled: 0 },
    B: { buffer: new Float32Array(WAVEFORM_BUFFER_MAX), writeIndex: 0, filled: 0 },
  }

  function setupMonitorBus() {
    monitorBusA?.dispose()
    monitorBusB?.dispose()

    monitorBusA = new Tone.Gain()
    monitorBusA.connect(waveformAnalyserA)
    monitorBusA.connect(fftAnalyserA)
    monitorBusA.toDestination()
    nodes.set(MONITOR_A_NODE_ID, monitorBusA)

    monitorBusB = new Tone.Gain()
    monitorBusB.connect(waveformAnalyserB)
    monitorBusB.connect(fftAnalyserB)
    monitorBusB.toDestination()
    nodes.set(MONITOR_B_NODE_ID, monitorBusB)
  }

  function resizeCanvasBuffer(canvas: HTMLCanvasElement, ctx: CanvasRenderingContext2D) {
    const rect = canvas.getBoundingClientRect()
    const dpr = window.devicePixelRatio || 1
    const displayWidth = Math.max(Math.round(rect.width * dpr), 1)
    const displayHeight = Math.max(Math.round(rect.height * dpr), 1)

    if (canvas.width !== displayWidth || canvas.height !== displayHeight) {
      canvas.width = displayWidth
      canvas.height = displayHeight
    }

    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.scale(dpr, dpr)

    return { width: rect.width, height: rect.height }
  }

  function resizeCanvases() {
    if (waveformCanvasA && waveformCtxA) {
      waveformSizeA = resizeCanvasBuffer(waveformCanvasA, waveformCtxA)
    }
    if (fftCanvasA && fftCtxA) {
      fftSizeA = resizeCanvasBuffer(fftCanvasA, fftCtxA)
    }
    if (waveformCanvasB && waveformCtxB) {
      waveformSizeB = resizeCanvasBuffer(waveformCanvasB, waveformCtxB)
    }
    if (fftCanvasB && fftCtxB) {
      fftSizeB = resizeCanvasBuffer(fftCanvasB, fftCtxB)
    }
  }

  function scheduleResize() {
    if (resizeTimeoutId !== null) {
      window.clearTimeout(resizeTimeoutId)
    }
    resizeTimeoutId = window.setTimeout(() => {
      resizeTimeoutId = null
      resizeCanvases()
      clearVisuals()
    }, 100)
  }

  function clearVisuals() {
    if (waveformCtxA && waveformCanvasA) {
      waveformCtxA.fillStyle = '#0b1221'
      waveformCtxA.fillRect(0, 0, waveformSizeA.width || waveformCanvasA.width, waveformSizeA.height || waveformCanvasA.height)
    }
    if (fftCtxA && fftCanvasA) {
      fftCtxA.fillStyle = '#0b1221'
      fftCtxA.fillRect(0, 0, fftSizeA.width || fftCanvasA.width, fftSizeA.height || fftCanvasA.height)
    }
    if (waveformCtxB && waveformCanvasB) {
      waveformCtxB.fillStyle = '#0b1221'
      waveformCtxB.fillRect(0, 0, waveformSizeB.width || waveformCanvasB.width, waveformSizeB.height || waveformCanvasB.height)
    }
    if (fftCtxB && fftCanvasB) {
      fftCtxB.fillStyle = '#0b1221'
      fftCtxB.fillRect(0, 0, fftSizeB.width || fftCanvasB.width, fftSizeB.height || fftCanvasB.height)
    }
  }

  function updateTimingDisplay(target: HTMLElement | null, durationMs: number) {
    if (!target) return
    const safeDuration = Number.isFinite(durationMs) && durationMs >= 0 ? durationMs : 0
    const text = `JS draw time: ${safeDuration.toFixed(1)} ms`
    if (target.textContent !== text) {
      target.textContent = text
    }
  }

  function resetTimingDisplays() {
    const placeholder = 'JS draw time: -- ms'
    if (waveformTimeA && waveformTimeA.textContent !== placeholder) {
      waveformTimeA.textContent = placeholder
    }
    if (fftTimeA && fftTimeA.textContent !== placeholder) {
      fftTimeA.textContent = placeholder
    }
    if (waveformTimeB && waveformTimeB.textContent !== placeholder) {
      waveformTimeB.textContent = placeholder
    }
    if (fftTimeB && fftTimeB.textContent !== placeholder) {
      fftTimeB.textContent = placeholder
    }
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

  function writeRingBuffer(group: Group, frame: Float32Array) {
    const state = waveformRingState[group]
    const { buffer } = state
    let writeIndex = state.writeIndex
    for (let i = 0; i < frame.length; i++) {
      buffer[writeIndex] = frame[i]
      writeIndex += 1
      if (writeIndex >= buffer.length) {
        writeIndex = 0
      }
    }
    state.writeIndex = writeIndex
    state.filled = Math.min(buffer.length, state.filled + frame.length)
  }

  function readRingBuffer(group: Group, length: number) {
    const state = waveformRingState[group]
    const { buffer } = state
    const available = Math.min(length, state.filled, buffer.length)
    if (available <= 0) {
      return new Float32Array(0)
    }
    const result = new Float32Array(available)
    const start = (state.writeIndex - available + buffer.length) % buffer.length
    const firstChunk = Math.min(available, buffer.length - start)
    result.set(buffer.subarray(start, start + firstChunk), 0)
    if (firstChunk < available) {
      result.set(buffer.subarray(0, available - firstChunk), firstChunk)
    }
    return result
  }

  function calculateWindowSamples(group: Group) {
    return Math.max(calculateCycleSamples(group) * 4, 1)
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
    group: Group,
    waveformValues: Float32Array,
    windowLength: number,
    cycleLength: number,
    maxIterations: number,
  ) {
    const effectiveWindow = Math.min(windowLength, waveformValues.length)
    const state = waveformWindowState[group]

    if (state.windowLength !== effectiveWindow) {
      state.windowLength = effectiveWindow
      state.prevSegment = null
      state.prevStart = 0
    }

    const maxStart = Math.max(0, waveformValues.length - effectiveWindow)
    const searchSpan = Math.min(maxStart, Math.max(Math.floor(cycleLength / 2), 1))
    const startMin = Math.max(0, maxStart - searchSpan)
    const startMax = maxStart
    let startIndex = startMax

    if (state.prevSegment && state.prevSegment.length === effectiveWindow && startMax > startMin) {
      const centerStart = Math.max(startMin, Math.min(state.prevStart, startMax))
      startIndex = findBestCorrelationStart(
        waveformValues,
        state.prevSegment,
        effectiveWindow,
        centerStart,
        startMax,
        maxIterations,
        startMin,
      )
    }

    const segment = waveformValues.slice(startIndex, startIndex + effectiveWindow)
    state.prevSegment = segment
    state.prevStart = startIndex
    return segment
  }

  function resetWaveformWindows() {
    waveformWindowState.A.prevSegment = null
    waveformWindowState.B.prevSegment = null
    waveformWindowState.A.prevStart = 0
    waveformWindowState.B.prevStart = 0
  }

  function resetWaveformGains() {
    waveformGainState.A.gain = 1
    waveformGainState.B.gain = 1
    waveformGainState.A.framesSincePeak = 0
    waveformGainState.B.framesSincePeak = 0
  }

  function drawGroupVisuals(
    group: Group,
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
    const targetWindowLength = calculateWindowSamples(group)
    ensureWaveformBuffer(waveformAnalyser, targetWindowLength)
    const latestFrame = waveformAnalyser.getValue() as Float32Array
    writeRingBuffer(group, latestFrame)
    const desiredBufferLength = Math.min(WAVEFORM_BUFFER_MAX, targetWindowLength + cycleLength)
    const waveformValues = readRingBuffer(group, desiredBufferLength)
    const availableCycles = waveformValues.length / Math.max(cycleLength, 1)
    const displayCycles =
      availableCycles >= 4 ? 4 : availableCycles >= 3 ? 3 : availableCycles >= 2 ? 2 : availableCycles >= 1 ? 1 : 0.5
    const windowLength = Math.min(waveformValues.length, Math.max(Math.round(displayCycles * cycleLength), 1))
    const waveformWidth = waveformSize.width || waveformCanvas.width
    const searchIterations = Math.max(1, Math.min(waveformWidth > 0 ? Math.round(waveformWidth) : 400, 400))
    const waveformSegment = selectWaveformSegment(group, waveformValues, windowLength, cycleLength, searchIterations)
    const waveformData = waveformSegment.length ? waveformSegment : waveformValues
    const gainState = waveformGainState[group]
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

  function drawVisuals() {
    if (!waveformCtxA || !fftCtxA || !waveformCanvasA || !fftCanvasA || !waveformCtxB || !fftCtxB || !waveformCanvasB || !fftCanvasB) return

    const timingsA = drawGroupVisuals(
      'A',
      waveformAnalyserA,
      fftAnalyserA,
      waveformCtxA,
      waveformCanvasA,
      waveformSizeA,
      fftCtxA,
      fftCanvasA,
      fftSizeA,
    )

    const timingsB = drawGroupVisuals(
      'B',
      waveformAnalyserB,
      fftAnalyserB,
      waveformCtxB,
      waveformCanvasB,
      waveformSizeB,
      fftCtxB,
      fftCanvasB,
      fftSizeB,
    )

    updateTimingDisplay(waveformTimeA, timingsA.waveformMs)
    updateTimingDisplay(fftTimeA, timingsA.fftMs)
    updateTimingDisplay(waveformTimeB, timingsB.waveformMs)
    updateTimingDisplay(fftTimeB, timingsB.fftMs)

    animationFrameId = window.requestAnimationFrame(drawVisuals)
  }

  function startVisuals() {
    resizeCanvases()
    resetTimingDisplays()
    if (animationFrameId === null) {
      drawVisuals()
    }
  }

  function stopVisuals() {
    if (animationFrameId !== null) {
      window.cancelAnimationFrame(animationFrameId)
      animationFrameId = null
    }
    resetWaveformWindows()
    resetWaveformGains()
    clearVisuals()
    resetTimingDisplays()
  }

  if (waveformCanvasA && fftCanvasA && waveformCtxA && fftCtxA && waveformCanvasB && fftCanvasB && waveformCtxB && fftCtxB) {
    resizeCanvases()
    clearVisuals()
    window.addEventListener('resize', scheduleResize)
  }

  return {
    setupMonitorBus,
    startVisuals,
    stopVisuals,
    clearVisuals,
  }
}
