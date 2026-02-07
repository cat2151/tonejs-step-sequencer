import './style.css'
import * as Tone from 'tone'
import { NDJSONStreamingPlayer, SequencerNodes, type SequenceEvent } from 'tonejs-json-sequencer'

const MONITOR_NODE_ID = 1
const STEPS = 16
const DEFAULT_MIDI_NOTE = 60
const PPQ = Tone.Transport.PPQ ?? 192
const SIXTEENTH_TICKS = PPQ / 4
const LOOP_TICKS = SIXTEENTH_TICKS * STEPS

const noteNumbers = Array.from({ length: STEPS }, () => DEFAULT_MIDI_NOTE)
let ndjsonSequence = ''

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
          It loops sixteen sixteenth notes (default <strong>C4</strong>) with per-step MIDI control using Tone.js.
        </p>
      </header>
      <section class="panel visuals">
        <div class="visual-header">
          <div>
            <p class="label">Realtime analysis</p>
            <p class="note">Waveform and FFT refresh ~60 FPS via Tone.Analyser.</p>
          </div>
          <div class="note-controls">
            <div>
              <p class="label">Note numbers (MIDI)</p>
              <p class="note">Edit each step to reshape the 16-step loop.</p>
            </div>
            <div class="note-input-row" id="note-inputs"></div>
          </div>
        </div>
        <div class="visual-grid">
          <canvas id="waveform" width="720" height="160" role="img" aria-label="Waveform display"></canvas>
          <canvas id="fft" width="720" height="160" role="img" aria-label="FFT display"></canvas>
        </div>
      </section>
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
          <pre id="ndjson"></pre>
          <p class="note">Loop runs at 120 BPM with a 16-step 16n sequence and explicit loop boundary.</p>
        </div>
      </section>
    </main>
    <a class="repo-link" href="https://github.com/cat2151/tonejs-step-sequencer" target="_blank" rel="noreferrer noopener">
      cat2151/tonejs-step-sequencer
    </a>
  `
}

function midiToNoteName(midi: number) {
  return Tone.Frequency(midi, 'midi').toNote()
}

function buildSequenceFromNotes() {
  const noteEvents: SequenceEvent[] = noteNumbers.map((noteNumber, index) => ({
    eventType: 'triggerAttackRelease',
    nodeId: 0,
    args: [midiToNoteName(noteNumber), '16n', `+${index * SIXTEENTH_TICKS}i`],
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

  ndjsonSequence = ndjsonEvents.map((event) => JSON.stringify(event)).join('\n')
}

const noteInputRow = document.querySelector<HTMLDivElement>('#note-inputs')
const ndjsonElement = document.querySelector<HTMLPreElement>('#ndjson')
const noteInputs: HTMLInputElement[] = []

function renderNoteInputs() {
  if (!noteInputRow) return
  noteInputRow.innerHTML = ''
  noteInputs.length = 0

  noteNumbers.forEach((noteNumber, index) => {
    const wrapper = document.createElement('label')
    wrapper.className = 'note-input'
    const stepLabel = document.createElement('span')
    stepLabel.className = 'note-index'
    stepLabel.textContent = `${index + 1}`
    const input = document.createElement('input')
    input.type = 'number'
    input.min = '0'
    input.max = '127'
    input.inputMode = 'numeric'
    input.value = `${noteNumber}`
    input.addEventListener('change', () => handleNoteInputChange(index, input.value))

    wrapper.appendChild(stepLabel)
    wrapper.appendChild(input)
    noteInputRow.appendChild(wrapper)
    noteInputs.push(input)
  })
}

function clampMidi(value: number) {
  if (!Number.isFinite(value)) return DEFAULT_MIDI_NOTE
  return Math.min(127, Math.max(0, Math.round(value)))
}

function updateNdjsonDisplay() {
  if (ndjsonElement) {
    ndjsonElement.textContent = ndjsonSequence
  }
}

async function applySequenceChange() {
  buildSequenceFromNotes()
  updateNdjsonDisplay()

  const startup = startingPromise
  if (!player.playing && !startup) return

  try {
    if (startup) {
      await startup
    }
    if (player.playing) {
      await player.start(ndjsonSequence)
    }
  } catch (error) {
    console.error('Failed to apply sequence update', error)
    setStatus('idle')
  }
}

function handleNoteInputChange(index: number, value: string) {
  const parsed = Number.parseInt(value, 10)
  const midi = clampMidi(parsed)
  noteNumbers[index] = midi
  if (noteInputs[index]) {
    noteInputs[index].value = `${midi}`
  }
  void applySequenceChange()
}

const toggleButton = document.querySelector<HTMLButtonElement>('#toggle')
const statusLabel = document.querySelector<HTMLSpanElement>('#status-label')
const statusDot = document.querySelector<HTMLSpanElement>('#dot')
const waveformCanvas = document.querySelector<HTMLCanvasElement>('#waveform')
const fftCanvas = document.querySelector<HTMLCanvasElement>('#fft')
const waveformCtx = waveformCanvas?.getContext('2d')
const fftCtx = fftCanvas?.getContext('2d')

renderNoteInputs()
buildSequenceFromNotes()
updateNdjsonDisplay()

const waveformAnalyser = new Tone.Analyser('waveform', 1024)
const fftAnalyser = new Tone.Analyser('fft', 128)

let waveformSize: { width: number; height: number } = { width: 0, height: 0 }
let fftSize: { width: number; height: number } = { width: 0, height: 0 }
let resizeTimeoutId: number | null = null
let monitorBus: Tone.Gain | null = null
let animationFrameId: number | null = null
let startingPromise: Promise<void> | null = null

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
    statusLabel.textContent = 'Playing 16-step MIDI sequence in a loop'
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
  if (startingPromise) return startingPromise

  const thisStart = (async () => {
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
  })()

  startingPromise = thisStart
  try {
    await thisStart
  } catch (error) {
    console.error('Failed to start loop', error)
    setStatus('idle')
    stopVisuals()
    throw error
  } finally {
    if (startingPromise === thisStart) {
      startingPromise = null
    }
  }
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
