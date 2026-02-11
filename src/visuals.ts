import * as Tone from 'tone'
import type { SequencerNodes } from 'tonejs-json-sequencer'
import { MONITOR_A_NODE_ID, MONITOR_B_NODE_ID, WAVEFORM_BUFFER_MIN } from './constants'
import {
  createWaveformState,
  drawGroupVisuals,
  resetWaveformGains,
  resetWaveformWindows,
  type CanvasSize,
} from './visualsGroup'

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
  const waveformState = createWaveformState()

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

  function drawVisuals() {
    if (!waveformCtxA || !fftCtxA || !waveformCanvasA || !fftCanvasA || !waveformCtxB || !fftCtxB || !waveformCanvasB || !fftCanvasB) return

    const timingsA = drawGroupVisuals(
      'A',
      waveformState,
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
      waveformState,
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
    resetWaveformWindows(waveformState)
    resetWaveformGains(waveformState)
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
