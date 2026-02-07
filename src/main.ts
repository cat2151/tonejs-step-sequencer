import './style.css'
import * as Tone from 'tone'
import { NDJSONStreamingPlayer, SequencerNodes, type SequenceEvent } from 'tonejs-json-sequencer'

const MONITOR_NODE_ID = 1
const STEPS = 16
const PPQ = Tone.Transport.PPQ ?? 192
const SIXTEENTH_TICKS = PPQ / 4
const LOOP_TICKS = SIXTEENTH_TICKS * STEPS

const noteEvents: SequenceEvent[] = Array.from({ length: STEPS }, (_, index): SequenceEvent => ({
  eventType: 'triggerAttackRelease',
  nodeId: 0,
  args: ['C4', '16n', `+${index * SIXTEENTH_TICKS}i`],
}))

const ndjsonEvents: SequenceEvent[] = [
  {
    eventType: 'createNode',
    nodeId: 0,
    nodeType: 'Synth',
    args: { oscillator: { type: 'triangle' } },
  },
  {
    eventType: 'connect',
    nodeId: 0,
    connectTo: MONITOR_NODE_ID,
  },
  ...noteEvents,
  {
    eventType: 'loopEnd',
    nodeId: 0,
    args: [`${LOOP_TICKS}i`],
  },
]

const ndjsonSequence = ndjsonEvents.map((event) => JSON.stringify(event)).join('\n')

const nodes = new SequencerNodes()
const player = new NDJSONStreamingPlayer(Tone, nodes, {
  loop: true,
  loopWaitSeconds: 0,
  lookaheadMs: 60,
})

const app = document.querySelector<HTMLDivElement>('#app')

if (app) {
  app.innerHTML = `
    <main class="shell">
      <header class="hero">
        <p class="eyebrow">Tone.js JSON Sequencer</p>
        <h1>16-step streaming loop</h1>
        <p class="lede">
          Minimal NDJSON streaming demo inspired by the demo-library and streaming sample.
          It loops sixteen <strong>C4</strong> sixteenth notes using Tone.js.
        </p>
      </header>
      <section class="panel">
        <div class="controls">
          <button id="toggle" type="button" class="primary">Start loop</button>
          <div class="status">
            <span class="dot dot-idle" id="dot"></span>
            <span id="status-label">Idle – waiting for user gesture</span>
          </div>
        </div>
        <div class="details">
          <p class="label">NDJSON payload</p>
          <pre id="ndjson">${ndjsonSequence}</pre>
          <p class="note">Loop runs at 120 BPM with a 16-step 16n sequence and explicit loop boundary.</p>
        </div>
      </section>
      <section class="panel visuals">
        <div class="visual-header">
          <div>
            <p class="label">Realtime analysis</p>
            <p class="note">Waveform and FFT refresh ~60 FPS via Tone.Analyser.</p>
          </div>
        </div>
        <div class="visual-grid">
          <canvas id="waveform" width="720" height="160" role="img" aria-label="Waveform display"></canvas>
          <canvas id="fft" width="720" height="160" role="img" aria-label="FFT display"></canvas>
        </div>
      </section>
    </main>
  `
}

const toggleButton = document.querySelector<HTMLButtonElement>('#toggle')
const statusLabel = document.querySelector<HTMLSpanElement>('#status-label')
const statusDot = document.querySelector<HTMLSpanElement>('#dot')
const waveformCanvas = document.querySelector<HTMLCanvasElement>('#waveform')
const fftCanvas = document.querySelector<HTMLCanvasElement>('#fft')
const waveformCtx = waveformCanvas?.getContext('2d')
const fftCtx = fftCanvas?.getContext('2d')

const waveformAnalyser = new Tone.Analyser('waveform', 1024)
const fftAnalyser = new Tone.Analyser('fft', 128)

let waveformSize: { width: number; height: number } = { width: 0, height: 0 }
let fftSize: { width: number; height: number } = { width: 0, height: 0 }
let resizeTimeoutId: number | null = null
let monitorBus: Tone.Gain | null = null
let animationFrameId: number | null = null

function setStatus(state: 'idle' | 'starting' | 'playing') {
  if (!statusLabel || !statusDot || !toggleButton) return

  if (state === 'idle') {
    statusLabel.textContent = 'Idle – waiting for user gesture'
    statusDot.className = 'dot dot-idle'
    toggleButton.textContent = 'Start loop'
    toggleButton.disabled = false
  } else if (state === 'starting') {
    statusLabel.textContent = 'Starting audio context…'
    statusDot.className = 'dot dot-pending'
    toggleButton.disabled = true
  } else {
    statusLabel.textContent = 'Playing 16-step C4 sixteenth notes in a loop'
    statusDot.className = 'dot dot-active'
    toggleButton.textContent = 'Stop loop'
    toggleButton.disabled = false
  }
}

function setupMonitorBus() {
  monitorBus?.dispose()
  monitorBus = new Tone.Gain()
  monitorBus.connect(waveformAnalyser)
  monitorBus.connect(fftAnalyser)
  monitorBus.toDestination()
  nodes.set(MONITOR_NODE_ID, monitorBus)
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
  if (waveformCanvas && waveformCtx) {
    waveformSize = resizeCanvasBuffer(waveformCanvas, waveformCtx)
  }
  if (fftCanvas && fftCtx) {
    fftSize = resizeCanvasBuffer(fftCanvas, fftCtx)
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

if (waveformCanvas && fftCanvas && waveformCtx && fftCtx) {
  resizeCanvases()
  clearVisuals()
  window.addEventListener('resize', scheduleResize)
}

function clearVisuals() {
  if (waveformCtx && waveformCanvas) {
    waveformCtx.fillStyle = '#0b1221'
    waveformCtx.fillRect(0, 0, waveformSize.width || waveformCanvas.width, waveformSize.height || waveformCanvas.height)
  }
  if (fftCtx && fftCanvas) {
    fftCtx.fillStyle = '#0b1221'
    fftCtx.fillRect(0, 0, fftSize.width || fftCanvas.width, fftSize.height || fftCanvas.height)
  }
}

function drawVisuals() {
  if (!waveformCtx || !fftCtx || !waveformCanvas || !fftCanvas) return

  const waveformValues = waveformAnalyser.getValue() as Float32Array
  const fftValues = fftAnalyser.getValue() as Float32Array
  const waveformWidth = waveformSize.width || waveformCanvas.width
  const waveformHeight = waveformSize.height || waveformCanvas.height
  const fftWidth = fftSize.width || fftCanvas.width
  const fftHeight = fftSize.height || fftCanvas.height

  waveformCtx.fillStyle = '#0b1221'
  waveformCtx.fillRect(0, 0, waveformWidth, waveformHeight)
  waveformCtx.strokeStyle = '#7cf2c2'
  waveformCtx.lineWidth = 2
  waveformCtx.beginPath()
  waveformValues.forEach((value, index) => {
    const x = (index / (waveformValues.length - 1)) * waveformWidth
    const y = ((1 - (value + 1) / 2) * waveformHeight)
    if (index === 0) {
      waveformCtx.moveTo(x, y)
    } else {
      waveformCtx.lineTo(x, y)
    }
  })
  waveformCtx.stroke()

  fftCtx.fillStyle = '#0b1221'
  fftCtx.fillRect(0, 0, fftWidth, fftHeight)
  fftCtx.fillStyle = '#5dbbff'
  const barWidth = fftWidth / fftValues.length
  fftValues.forEach((value, index) => {
    const magnitude = Math.max((value + 140) / 140, 0)
    const barHeight = magnitude * fftHeight
    const x = index * barWidth
    const y = fftHeight - barHeight
    fftCtx.fillRect(x, y, barWidth - 1, barHeight)
  })

  animationFrameId = window.requestAnimationFrame(drawVisuals)
}

function startVisuals() {
  resizeCanvases()
  if (animationFrameId === null) {
    drawVisuals()
  }
}

function stopVisuals() {
  if (animationFrameId !== null) {
    window.cancelAnimationFrame(animationFrameId)
    animationFrameId = null
  }
  clearVisuals()
}

async function startLoop() {
  if (player.playing) return

  setStatus('starting')
  await Tone.start()
  Tone.Transport.stop()
  Tone.Transport.bpm.value = 120
  nodes.disposeAll()
  monitorBus = null
  setupMonitorBus()

  await player.start(ndjsonSequence)
  setStatus('playing')
  startVisuals()
}

function stopLoop() {
  if (!player.playing) return
  player.stop()
  Tone.Transport.stop()
  nodes.disposeAll()
  setStatus('idle')
  stopVisuals()
}

toggleButton?.addEventListener('click', () => {
  if (player.playing) {
    stopLoop()
  } else {
    startLoop().catch((error) => {
      console.error('Failed to start loop', error)
      setStatus('idle')
    })
  }
})
