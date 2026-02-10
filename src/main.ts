import './style.css'
import * as Tone from 'tone'
import { NDJSONStreamingPlayer, SequencerNodes } from 'tonejs-json-sequencer'
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
              <canvas id="fft-a" width="720" height="120" role="img" aria-label="Group A FFT display"></canvas>
            </div>
            <div class="visual-group">
              <p class="visual-label">Group B</p>
              <canvas id="waveform-b" width="720" height="120" role="img" aria-label="Group B Waveform display"></canvas>
              <canvas id="fft-b" width="720" height="120" role="img" aria-label="Group B FFT display"></canvas>
            </div>
          </div>
        </div>
      </section>
      <section class="panel">
        <div class="details">
          <label class="label" for="ndjson">NDJSON payload</label>
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

toggleButton?.focus()

let startingPromise: Promise<void> | null = null
let sequenceUpdatePromise: Promise<void> | null = null

const visuals = createVisuals(nodes)

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
    await player.start(getNdjsonSequence())
  })

  sequenceUpdatePromise = thisUpdate

  try {
    await thisUpdate
  } catch (error) {
    console.error('Failed to apply sequence update', error)
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
  await queueSequenceUpdate()
}

initializeNoteGrid(applySequenceChange, queueSequenceUpdate)
updateLoopNote()
updateNdjsonDisplay()
void initializeTonePresets(applySequenceChange)

async function startLoop() {
  if (player.playing) return
  if (startingPromise) return startingPromise

  const thisStart = (async () => {
    setStatus('starting')
    await Tone.start()
    Tone.Transport.stop()
    nodes.disposeAll()
    visuals.setupMonitorBus()

    await player.start(getNdjsonSequence())
    setStatus('playing')
    visuals.startVisuals()
  })()

  startingPromise = thisStart
  try {
    await thisStart
  } catch (error) {
    console.error('Failed to start loop', error)
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
