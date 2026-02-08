import './style.css'
import * as Tone from 'tone'
import { NDJSONStreamingPlayer, SequencerNodes, type SequenceEvent } from 'tonejs-json-sequencer'

const MONITOR_NODE_ID = 1
const STEPS = 16
const DEFAULT_MIDI_NOTE = 60
const DEFAULT_BPM = 120
const DEFAULT_NOTE_ROWS = ['C5', 'C4', 'C3', 'C2', 'C1', 'C0'] as const
const GROUP_SIZE = 3
const GROUP_A_NODE_ID = 0
const GROUP_B_NODE_ID = 2
const PPQ = Tone.Transport.PPQ ?? 192
const SIXTEENTH_TICKS = PPQ / 4
type Group = 'A' | 'B'

const rowNoteNames: string[] = [...DEFAULT_NOTE_ROWS]
const selectedRowsA = Array.from({ length: STEPS }, () => 1)
const selectedRowsB = Array.from({ length: STEPS }, () => GROUP_SIZE + 1)
const noteNumbersA = selectedRowsA.map((row) => noteNameToMidi(rowNoteNames[row]))
const noteNumbersB = selectedRowsB.map((row) => noteNameToMidi(rowNoteNames[row]))
let bpmValue = DEFAULT_BPM
let ndjsonSequence = ''
const bpmMap = Array.from({ length: STEPS }, () => DEFAULT_BPM)

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
        <div class="visual-header">
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
        </div>
        <div class="visual-grid">
          <canvas id="waveform" width="720" height="160" role="img" aria-label="Waveform display"></canvas>
          <canvas id="fft" width="720" height="160" role="img" aria-label="FFT display"></canvas>
        </div>
      </section>
      <section class="panel">
        <div class="details">
          <p class="label">NDJSON payload</p>
          <pre id="ndjson"></pre>
          <p class="note" id="loop-note">Loop runs at ${DEFAULT_BPM} BPM with a 16-step 16n sequence and explicit loop boundary.</p>
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

function noteNameToMidi(noteName: string, fallbackMidi: number = DEFAULT_MIDI_NOTE) {
  try {
    const midi = Tone.Frequency(noteName).toMidi()
    if (!Number.isFinite(midi)) return clampMidi(fallbackMidi)
    return clampMidi(midi)
  } catch (error) {
    console.warn('Invalid note name; reverting to fallback MIDI note.', noteName, error)
    return clampMidi(fallbackMidi)
  }
}

function rowIndexToGroup(rowIndex: number): Group {
  return rowIndex < GROUP_SIZE ? 'A' : 'B'
}

function getSelections(group: Group) {
  return group === 'A' ? selectedRowsA : selectedRowsB
}

function getNoteNumbers(group: Group) {
  return group === 'A' ? noteNumbersA : noteNumbersB
}

function buildSequenceFromNotes() {
  const { startTicks, loopTicks } = buildTimingMap()
  const noteEvents: SequenceEvent[] = []
  for (let step = 0; step < STEPS; step++) {
    noteEvents.push(
      {
        eventType: 'triggerAttackRelease',
        nodeId: GROUP_A_NODE_ID,
        args: [midiToNoteName(noteNumbersA[step]), '16n', `+${startTicks[step]}i`],
      },
      {
        eventType: 'triggerAttackRelease',
        nodeId: GROUP_B_NODE_ID,
        args: [midiToNoteName(noteNumbersB[step]), '16n', `+${startTicks[step]}i`],
      },
    )
  }

  const ndjsonEvents: SequenceEvent[] = [
    {
      eventType: 'createNode',
      nodeId: GROUP_A_NODE_ID,
      nodeType: 'Synth',
      args: { oscillator: { type: 'triangle' } },
    },
    {
      eventType: 'connect',
      nodeId: GROUP_A_NODE_ID,
      connectTo: MONITOR_NODE_ID,
    },
    {
      eventType: 'createNode',
      nodeId: GROUP_B_NODE_ID,
      nodeType: 'Synth',
      args: { oscillator: { type: 'triangle' } },
    },
    {
      eventType: 'connect',
      nodeId: GROUP_B_NODE_ID,
      connectTo: MONITOR_NODE_ID,
    },
    ...noteEvents,
    {
      eventType: 'loopEnd',
      nodeId: GROUP_A_NODE_ID,
      args: [`${loopTicks}i`],
    },
    {
      eventType: 'loopEnd',
      nodeId: GROUP_B_NODE_ID,
      args: [`${loopTicks}i`],
    },
  ]

  ndjsonSequence = ndjsonEvents.map((event) => JSON.stringify(event)).join('\n')
}

const noteGrid = document.querySelector<HTMLDivElement>('#note-grid')
const ndjsonElement = document.querySelector<HTMLPreElement>('#ndjson')
const loopNoteElement = document.querySelector<HTMLParagraphElement>('#loop-note')
const bpmInput = document.querySelector<HTMLInputElement>('#bpm-input')
const rowInputs: HTMLInputElement[] = []
const gridCells: HTMLButtonElement[][] = []

function clampMidi(value: number) {
  if (!Number.isFinite(value)) return DEFAULT_MIDI_NOTE
  return Math.min(127, Math.max(0, Math.round(value)))
}

function clampBpm(value: number) {
  if (!Number.isFinite(value)) return DEFAULT_BPM
  return Math.min(300, Math.max(1, Math.round(value)))
}

function getStepBpm(stepIndex: number) {
  return clampBpm(bpmMap[stepIndex] ?? DEFAULT_BPM)
}

function getStepTicks(stepIndex: number) {
  return SIXTEENTH_TICKS * (DEFAULT_BPM / getStepBpm(stepIndex))
}

function buildTimingMap() {
  const startTicks: number[] = []
  let tickCursor = 0
  for (let step = 0; step < STEPS; step++) {
    startTicks.push(Math.round(tickCursor))
    tickCursor += getStepTicks(step)
  }
  return { startTicks, loopTicks: Math.round(tickCursor) }
}

function updateLoopNote() {
  if (loopNoteElement) {
    loopNoteElement.textContent = `Loop runs at ${bpmValue} BPM with a 16-step 16n sequence and explicit loop boundary.`
  }
}

function updateNdjsonDisplay() {
  if (ndjsonElement) {
    ndjsonElement.textContent = ndjsonSequence
  }
}

function updateGridActiveStates() {
  gridCells.forEach((cells, rowIndex) => {
    const selections = getSelections(rowIndexToGroup(rowIndex))
    cells.forEach((cell, stepIndex) => {
      const active = selections[stepIndex] === rowIndex
      cell.classList.toggle('active', active)
      cell.setAttribute('aria-pressed', active ? 'true' : 'false')
    })
  })
}

function updateRowCellLabels(rowIndex: number) {
  const noteName = rowNoteNames[rowIndex]
  gridCells[rowIndex]?.forEach((cell, stepIndex) => {
    cell.setAttribute('aria-label', `Step ${stepIndex + 1}, row ${rowIndex + 1} (${noteName})`)
  })
}

function renderNoteGrid() {
  if (!noteGrid) return
  noteGrid.innerHTML = ''
  gridCells.length = 0
  rowInputs.length = 0

  const headerRow = document.createElement('div')
  headerRow.className = 'note-grid-row note-grid-header'
  const spacer = document.createElement('div')
  spacer.className = 'note-row-label'
  headerRow.appendChild(spacer)
  for (let step = 0; step < STEPS; step++) {
    const stepLabel = document.createElement('span')
    stepLabel.className = 'note-step-label'
    stepLabel.textContent = `${step + 1}`
    headerRow.appendChild(stepLabel)
  }
  noteGrid.appendChild(headerRow)

  rowNoteNames.forEach((noteName, rowIndex) => {
    if (rowIndex === 0 || rowIndex === GROUP_SIZE) {
      const groupLabel = document.createElement('p')
      groupLabel.className = 'group-label'
      groupLabel.textContent = rowIndex === 0 ? 'Group A' : 'Group B'
      noteGrid.appendChild(groupLabel)
    }

    const rowElement = document.createElement('div')
    rowElement.className = 'note-grid-row'

    const labelWrapper = document.createElement('label')
    labelWrapper.className = 'note-row-label'
    const input = document.createElement('input')
    input.type = 'text'
    input.className = 'text-input'
    input.value = noteName
    input.setAttribute('aria-label', `Row ${rowIndex + 1} note`)
    input.addEventListener('change', () => handleRowNoteInputChange(rowIndex, input.value))
    labelWrapper.appendChild(input)
    rowInputs[rowIndex] = input
    rowElement.appendChild(labelWrapper)

    const cells: HTMLButtonElement[] = []
    for (let step = 0; step < STEPS; step++) {
      const cell = document.createElement('button')
      cell.type = 'button'
      cell.className = 'note-cell'
      cell.setAttribute('aria-label', `Step ${step + 1}, row ${rowIndex + 1} (${noteName})`)
      cell.addEventListener('click', () => handleStepSelection(step, rowIndex))
      rowElement.appendChild(cell)
      cells.push(cell)
    }

    gridCells[rowIndex] = cells
    noteGrid.appendChild(rowElement)
  })

  updateGridActiveStates()
}

function updateNoteNumbersForRow(rowIndex: number, midiValue: number) {
  const group = rowIndexToGroup(rowIndex)
  const selections = getSelections(group)
  const notes = getNoteNumbers(group)
  selections.forEach((selectedRow, stepIndex) => {
    if (selectedRow === rowIndex) {
      notes[stepIndex] = midiValue
    }
  })
}

async function applySequenceChange() {
  buildSequenceFromNotes()
  updateNdjsonDisplay()

  const startup = startingPromise
  if (!player.playing && !startup) return

  const thisUpdate = (sequenceUpdatePromise ?? Promise.resolve()).then(async () => {
    if (startup) {
      await startup
    }
    if (!player.playing) return
    await player.start(ndjsonSequence)
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

function handleStepSelection(stepIndex: number, rowIndex: number) {
  const group = rowIndexToGroup(rowIndex)
  const selections = getSelections(group)
  const notes = getNoteNumbers(group)
  selections[stepIndex] = rowIndex
  notes[stepIndex] = noteNameToMidi(rowNoteNames[rowIndex])
  updateGridActiveStates()
  void applySequenceChange()
}

function handleRowNoteInputChange(rowIndex: number, value: string) {
  const trimmed = value.trim()
  const previousMidi = noteNameToMidi(rowNoteNames[rowIndex])
  const midi = noteNameToMidi(trimmed || rowNoteNames[rowIndex], previousMidi)
  const normalized = midiToNoteName(midi)
  rowNoteNames[rowIndex] = normalized
  if (rowInputs[rowIndex]) {
    rowInputs[rowIndex].value = normalized
  }
  updateNoteNumbersForRow(rowIndex, midi)
  updateRowCellLabels(rowIndex)
  updateGridActiveStates()
  void applySequenceChange()
}

function handleBpmInputChange(value: string) {
  const parsed = Number.parseFloat(value)
  const bpm = clampBpm(parsed)
  bpmValue = bpm
  if (bpmInput) {
    bpmInput.value = `${bpm}`
  }
  bpmMap.fill(bpm)
  updateLoopNote()
  void applySequenceChange()
}

const toggleButton = document.querySelector<HTMLButtonElement>('#toggle')
const statusLabel = document.querySelector<HTMLSpanElement>('#status-label')
const statusDot = document.querySelector<HTMLSpanElement>('#dot')
const waveformCanvas = document.querySelector<HTMLCanvasElement>('#waveform')
const fftCanvas = document.querySelector<HTMLCanvasElement>('#fft')
const waveformCtx = waveformCanvas?.getContext('2d')
const fftCtx = fftCanvas?.getContext('2d')

renderNoteGrid()
buildSequenceFromNotes()
updateLoopNote()
updateNdjsonDisplay()

bpmInput?.addEventListener('change', () => handleBpmInputChange(bpmInput.value))

const waveformAnalyser = new Tone.Analyser('waveform', 1024)
const fftAnalyser = new Tone.Analyser('fft', 128)

let waveformSize: { width: number; height: number } = { width: 0, height: 0 }
let fftSize: { width: number; height: number } = { width: 0, height: 0 }
let resizeTimeoutId: number | null = null
let monitorBus: Tone.Gain | null = null
let animationFrameId: number | null = null
let startingPromise: Promise<void> | null = null
let sequenceUpdatePromise: Promise<void> | null = null

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
