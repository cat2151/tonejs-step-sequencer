import './style.css'
import * as Tone from 'tone'
import { NDJSONStreamingPlayer, SequencerNodes } from 'tonejs-json-sequencer'

const ndjsonSequence = [
  '{"eventType":"createNode","nodeId":0,"nodeType":"Synth","args":{"oscillator":{"type":"triangle"}}}',
  '{"eventType":"connect","nodeId":0,"connectTo":"toDestination"}',
  '{"eventType":"triggerAttackRelease","nodeId":0,"args":["C4","4n","0"]}',
  '{"eventType":"loopEnd","nodeId":0,"args":["4n"]}',
].join('\n')

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
        <h1>Streaming loop check</h1>
        <p class="lede">
          Minimal NDJSON streaming demo inspired by the demo-library and streaming sample.
          It loops a single <strong>C4</strong> quarter note using Tone.js.
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
          <p class="note">Loop runs at 120 BPM with a 4n loop boundary.</p>
        </div>
      </section>
    </main>
  `
}

const toggleButton = document.querySelector<HTMLButtonElement>('#toggle')
const statusLabel = document.querySelector<HTMLSpanElement>('#status-label')
const statusDot = document.querySelector<HTMLSpanElement>('#dot')

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
    statusLabel.textContent = 'Playing C4 quarter notes in a loop'
    statusDot.className = 'dot dot-active'
    toggleButton.textContent = 'Stop loop'
    toggleButton.disabled = false
  }
}

async function startLoop() {
  if (player.playing) return

  setStatus('starting')
  await Tone.start()
  Tone.Transport.stop()
  Tone.Transport.bpm.value = 120
  nodes.disposeAll()

  await player.start(ndjsonSequence)
  setStatus('playing')
}

function stopLoop() {
  if (!player.playing) return
  player.stop()
  Tone.Transport.stop()
  nodes.disposeAll()
  setStatus('idle')
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
