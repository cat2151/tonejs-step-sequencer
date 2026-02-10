import './style.css'
import * as Tone from 'tone'
import { NDJSONStreamingPlayer, SequencerNodes, parseNDJSON, type SequenceEvent } from 'tonejs-json-sequencer'
import { DEFAULT_BPM, PPQ } from './constants'
import { buildSequenceFromNotes, getNdjsonSequence, initializeNoteGrid, updateLoopNote, updateNdjsonDisplay } from './noteGrid'
import { initializeTonePresets } from './toneControls'
import { createVisuals } from './visuals'

const nodes = new SequencerNodes()
const player = new NDJSONStreamingPlayer(Tone, nodes, {
  loop: true,
  loopWaitSeconds: 0,
  lookaheadMs: 60,
  ticksPerQuarter: PPQ,
})

const app = document.querySelector<HTMLDivElement>('#app')

if (app) {
  app.innerHTML = `
    <main class="shell">
      <section class="panel">
        <div class="controls">
          <button id="toggle" type="button" class="primary">Play</button>
          <div class="status">
            <span class="dot dot-idle" id="dot"></span>
            <span id="status-label"></span>
          </div>
        </div>
      </section>
      <section class="panel visuals">
        <div class="visual-layout">
          <div class="note-controls">
            <div class="note-controls-header">
              <label class="field" for="bpm-input">
                <span class="label">BPM</span>
                <input id="bpm-input" class="text-input" type="number" inputmode="decimal" min="1" max="300" value="${DEFAULT_BPM}">
              </label>
              <div>
                <p class="label">Note grid</p>
              </div>
            </div>
            <div class="note-grid" id="note-grid"></div>
          </div>
          <div class="visual-grid">
            <div class="visual-group">
              <p class="visual-label">Group A</p>
              <canvas id="waveform-a" width="720" height="120" role="img" aria-label="Group A Waveform display"></canvas>
              <p class="visual-timing" id="waveform-a-time"></p>
              <canvas id="fft-a" width="720" height="120" role="img" aria-label="Group A FFT display"></canvas>
              <p class="visual-timing" id="fft-a-time"></p>
            </div>
            <div class="visual-group">
              <p class="visual-label">Group B</p>
              <canvas id="waveform-b" width="720" height="120" role="img" aria-label="Group B Waveform display"></canvas>
              <p class="visual-timing" id="waveform-b-time"></p>
              <canvas id="fft-b" width="720" height="120" role="img" aria-label="Group B FFT display"></canvas>
              <p class="visual-timing" id="fft-b-time"></p>
            </div>
          </div>
        </div>
      </section>
      <section class="panel">
        <div class="details">
          <div class="ndjson-header">
            <label class="label" for="ndjson">NDJSON payload</label>
            <div class="ndjson-error" id="ndjson-error" hidden>
              <span class="dot dot-error" aria-hidden="true"></span>
              <span class="ndjson-error-label" id="ndjson-error-label">Error</span>
              <button
                type="button"
                class="ndjson-error-button"
                id="ndjson-error-toggle"
                aria-expanded="false"
              >
                Show error
              </button>
            </div>
          </div>
          <div class="ndjson-error-details" id="ndjson-error-details" hidden>
            <pre id="ndjson-error-text"></pre>
          </div>
          <textarea id="ndjson" class="text-input tone-textarea" rows="8" spellcheck="false"></textarea>
          <p class="note" id="loop-note">Loop runs at ${DEFAULT_BPM} BPM with a 16-step 16n sequence and explicit loop boundary.</p>
        </div>
      </section>
    </main>
    <a class="repo-link" href="https://github.com/cat2151/tonejs-step-sequencer" target="_blank" rel="noreferrer noopener">
      cat2151/tonejs-step-sequencer
    </a>
  `
}

const toggleButton = document.querySelector<HTMLButtonElement>('#toggle')
const statusLabel = document.querySelector<HTMLSpanElement>('#status-label')
const statusDot = document.querySelector<HTMLSpanElement>('#dot')
const ndjsonError = document.querySelector<HTMLDivElement>('#ndjson-error')
const ndjsonErrorLabel = document.querySelector<HTMLSpanElement>('#ndjson-error-label')
const ndjsonErrorToggle = document.querySelector<HTMLButtonElement>('#ndjson-error-toggle')
const ndjsonErrorDetails = document.querySelector<HTMLDivElement>('#ndjson-error-details')
const ndjsonErrorText = document.querySelector<HTMLPreElement>('#ndjson-error-text')
const ndjsonTextarea = document.querySelector<HTMLTextAreaElement>('#ndjson')

toggleButton?.focus()

let startingPromise: Promise<void> | null = null
let sequenceUpdatePromise: Promise<void> | null = null

const visuals = createVisuals(nodes)

function formatErrorDetail(error: unknown) {
  if (error instanceof Error) {
    return error.stack ?? `${error.name}: ${error.message}`
  }
  if (typeof error === 'string') {
    return error
  }
  try {
    return JSON.stringify(error, null, 2)
  } catch {
    return `${error}`
  }
}

function setNdjsonError(message: string, detail?: unknown) {
  if (!ndjsonError || !ndjsonErrorLabel || !ndjsonErrorToggle || !ndjsonErrorDetails || !ndjsonErrorText) return
  ndjsonErrorLabel.textContent = message
  ndjsonError.removeAttribute('hidden')
  ndjsonErrorToggle.removeAttribute('hidden')
  ndjsonErrorToggle.setAttribute('aria-expanded', 'false')
  ndjsonErrorToggle.textContent = 'Show error'
  ndjsonErrorDetails.setAttribute('hidden', '')
  ndjsonErrorText.textContent = detail !== undefined ? formatErrorDetail(detail) : message
}

function clearNdjsonError() {
  if (!ndjsonError || !ndjsonErrorToggle || !ndjsonErrorDetails || !ndjsonErrorText) return
  ndjsonError.setAttribute('hidden', '')
  ndjsonErrorToggle.setAttribute('aria-expanded', 'false')
  ndjsonErrorToggle.textContent = 'Show error'
  ndjsonErrorDetails.setAttribute('hidden', '')
  ndjsonErrorText.textContent = ''
}

function toggleNdjsonErrorDetails(force?: boolean) {
  if (!ndjsonError || !ndjsonErrorToggle || !ndjsonErrorDetails) return
  if (ndjsonError.hasAttribute('hidden')) return
  const nextOpen = force ?? ndjsonErrorToggle.getAttribute('aria-expanded') !== 'true'
  ndjsonErrorToggle.setAttribute('aria-expanded', nextOpen ? 'true' : 'false')
  ndjsonErrorToggle.textContent = nextOpen ? 'Hide error' : 'Show error'
  if (nextOpen) {
    ndjsonErrorDetails.removeAttribute('hidden')
  } else {
    ndjsonErrorDetails.setAttribute('hidden', '')
  }
}

ndjsonErrorToggle?.addEventListener('click', () => toggleNdjsonErrorDetails())

function previewNdjsonValidation(ndjson: string) {
  try {
    parseNDJSON(ndjson)
    if (!player.playing && !startingPromise) {
      clearNdjsonError()
    }
  } catch (error) {
    setNdjsonError('Failed to parse NDJSON', error)
  }
}

function applyToneUpdates(ndjson: string) {
  let events: SequenceEvent[] = []
  try {
    events = parseNDJSON(ndjson)
  } catch (error) {
    console.warn('Failed to parse NDJSON for tone update', error)
    setNdjsonError('Failed to parse NDJSON', error)
    return
  }

  events.forEach((event) => {
    if (event.eventType !== 'createNode') return
    const node = nodes.get(event.nodeId)
    if (!node) return
    const args = (event as { args?: unknown }).args
    const options = Array.isArray(args) ? args[0] : args
    if (!options || typeof options !== 'object') return
    if (typeof (node as { set?: unknown }).set === 'function') {
      try {
        ;(node as { set: (value: unknown) => void }).set(options)
      } catch (error) {
        console.warn('Failed to apply tone update', error)
        setNdjsonError('Failed to apply tone update', error)
      }
    }
  })
}

function setStatus(state: 'idle' | 'starting' | 'playing') {
  if (!statusDot || !toggleButton) return

  if (statusLabel) {
    statusLabel.textContent = ''
  }

  if (state === 'idle') {
    statusDot.className = 'dot dot-idle'
    toggleButton.textContent = 'Play'
    toggleButton.disabled = false
  } else if (state === 'starting') {
    statusDot.className = 'dot dot-pending'
    toggleButton.disabled = true
  } else {
    statusDot.className = 'dot dot-active'
    toggleButton.textContent = 'Stop'
    toggleButton.disabled = false
  }
}

function stopLoop() {
  if (!player.playing) return
  player.stop()
  Tone.Transport.stop()
  nodes.disposeAll()
  setStatus('idle')
  visuals.stopVisuals()
}

async function queueSequenceUpdate() {
  const startup = startingPromise
  if (!player.playing && !startup) return

  const thisUpdate = (sequenceUpdatePromise ?? Promise.resolve()).then(async () => {
    if (startup) {
      await startup
    }
    if (!player.playing) return
    const ndjson = getNdjsonSequence()
    applyToneUpdates(ndjson)
    try {
      await player.start(ndjson)
      clearNdjsonError()
    } catch (error) {
      setNdjsonError('Failed to apply sequence update', error)
      throw error
    }
  })

  sequenceUpdatePromise = thisUpdate

  try {
    await thisUpdate
  } catch (error) {
    console.error('Failed to apply sequence update', error)
    setNdjsonError('Failed to apply sequence update', error)
    stopLoop()
  } finally {
    if (sequenceUpdatePromise === thisUpdate) {
      sequenceUpdatePromise = null
    }
  }
}

async function applySequenceChange() {
  buildSequenceFromNotes()
  updateNdjsonDisplay()
  previewNdjsonValidation(getNdjsonSequence())
  await queueSequenceUpdate()
}

initializeNoteGrid(applySequenceChange, queueSequenceUpdate)
updateLoopNote()
updateNdjsonDisplay()
ndjsonTextarea?.addEventListener('input', () => {
  if (!ndjsonTextarea) return
  previewNdjsonValidation(ndjsonTextarea.value)
})
void initializeTonePresets(applySequenceChange)

async function startLoop() {
  if (player.playing) return
  if (startingPromise) return startingPromise

  const thisStart = (async () => {
    setStatus('starting')
    const ndjson = getNdjsonSequence()
    previewNdjsonValidation(ndjson)
    await Tone.start()
    Tone.Transport.stop()
    nodes.disposeAll()
    visuals.setupMonitorBus()

    try {
      await player.start(ndjson)
      clearNdjsonError()
    } catch (error) {
      setNdjsonError('Failed to start loop', error)
      throw error
    }
    setStatus('playing')
    visuals.startVisuals()
  })()

  startingPromise = thisStart
  try {
    await thisStart
  } catch (error) {
    console.error('Failed to start loop', error)
    setNdjsonError('Failed to start loop', error)
    setStatus('idle')
    visuals.stopVisuals()
    throw error
  } finally {
    if (startingPromise === thisStart) {
      startingPromise = null
    }
  }
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
