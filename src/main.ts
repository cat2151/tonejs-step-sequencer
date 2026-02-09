import './style.css'
import * as Tone from 'tone'
import { NDJSONStreamingPlayer, SequencerNodes, type SequenceEvent } from 'tonejs-json-sequencer'
import { initWasm as initMmlWasm, mml2json } from 'tonejs-mml-to-json'

const MONITOR_NODE_ID = 1
const MONITOR_A_NODE_ID = 10011
const MONITOR_B_NODE_ID = 10021
const STEPS = 16
const DEFAULT_MIDI_NOTE = 60
const DEFAULT_BPM = 120
const DEFAULT_NOTE_ROWS = ['C5', 'C4', 'C3', 'C2', 'C1', 'C0'] as const
const GROUP_SIZE = 3
const GROUP_A_NODE_ID = 10
const GROUP_B_NODE_ID = 20
const PPQ = Tone.Transport.PPQ ?? 192
const SIXTEENTH_TICKS = PPQ / 4
const FFT_NORMALIZATION_OFFSET = 140
type Group = 'A' | 'B'

type TonePreset = {
  id: string
  label: string
  mml: string
}

type ToneState = {
  presetId: string
  mmlText: string
  jsonText: string
  events: SequenceEvent[]
  instrumentNodeId: number
  open: boolean
  error: string
}

type ToneControls = {
  toggle: HTMLButtonElement
  body: HTMLDivElement
  presetSelect: HTMLSelectElement
  mmlTextarea: HTMLTextAreaElement
  jsonTextarea: HTMLTextAreaElement
  status: HTMLSpanElement
}

const TONE_EVENT_TYPES = new Set(['createNode', 'connect', 'set'])

const tonePresets: TonePreset[] = [
  {
    id: 'fm-pingpong',
    label: 'FMSynth + PingPongDelay',
    mml: `@FMSynth{
  "harmonicity": 3,
  "modulationIndex": 10,
  "envelope": {
    "attack": 0.02,
    "decay": 0.15,
    "sustain": 0.6,
    "release": 0.8
  }
}
@PingPongDelay{
  "delayTime": "8n",
  "feedback": 0.35
}
o4 l8 cdefgab<c`,
  },
  {
    id: 'mono-chebyshev',
    label: 'MonoSynth + Chebyshev',
    mml: `@MonoSynth{
  "filter": {
    "Q": 2,
    "type": "lowpass",
    "rolloff": -12
  },
  "envelope": {
    "attack": 0.05,
    "decay": 0.3,
    "sustain": 0.2,
    "release": 1.2
  }
}
@Chebyshev{
  "order": 32,
  "oversample": "2x"
}
o3 l8 c c d d# f f g g`,
  },
  {
    id: 'synth-chorus',
    label: 'Synth + Chorus',
    mml: `@Synth{
  "oscillator": {
    "type": "sawtooth"
  },
  "envelope": {
    "attack": 0.08,
    "decay": 0.2,
    "sustain": 0.4,
    "release": 0.9
  }
}
@Chorus{
  "frequency": 4,
  "delayTime": 2.5,
  "depth": 0.6
}
o4 l8 c e g c e g<c`,
  },
]

const toneStates: Record<Group, ToneState> = {
  A: {
    presetId: 'fm-pingpong',
    mmlText: tonePresets[0]?.mml ?? '',
    jsonText: '',
    events: [],
    instrumentNodeId: GROUP_A_NODE_ID,
    open: false,
    error: '',
  },
  B: {
    presetId: 'mono-chebyshev',
    mmlText: tonePresets[1]?.mml ?? '',
    jsonText: '',
    events: [],
    instrumentNodeId: GROUP_B_NODE_ID,
    open: false,
    error: '',
  },
}

const toneControls: Partial<Record<Group, ToneControls>> = {}
let mmlInitPromise: Promise<void> | null = null

function getPresetById(id: string) {
  return tonePresets.find((preset) => preset.id === id)
}

function buildFallbackToneConfig(group: Group) {
  const nodeId = group === 'A' ? GROUP_A_NODE_ID : GROUP_B_NODE_ID
  const monitorNodeId = group === 'A' ? MONITOR_A_NODE_ID : MONITOR_B_NODE_ID
  const events: SequenceEvent[] = [
    {
      eventType: 'createNode',
      nodeId,
      nodeType: 'Synth',
      args: { oscillator: { type: 'triangle' } },
    },
    {
      eventType: 'connect',
      nodeId,
      connectTo: monitorNodeId,
    },
  ]
  return { events, instrumentNodeId: nodeId }
}

function primeToneState(group: Group) {
  const fallback = buildFallbackToneConfig(group)
  toneStates[group].events = fallback.events
  toneStates[group].instrumentNodeId = fallback.instrumentNodeId
  toneStates[group].jsonText = JSON.stringify(fallback.events, null, 2)
}

primeToneState('A')
primeToneState('B')

async function ensureMmlReady() {
  if (!mmlInitPromise) {
    mmlInitPromise = initMmlWasm()
  }
  await mmlInitPromise
}

function normalizeToneEvents(events: SequenceEvent[], group: Group) {
  const baseNodeId = group === 'A' ? GROUP_A_NODE_ID : GROUP_B_NODE_ID
  const monitorNodeId = group === 'A' ? MONITOR_A_NODE_ID : MONITOR_B_NODE_ID
  let nextNodeId = baseNodeId
  const idMap = new Map<number, number>()
  const mapId = (id: unknown) => {
    if (typeof id !== 'number') return null
    if (!idMap.has(id)) {
      idMap.set(id, nextNodeId)
      nextNodeId += 1
    }
    return idMap.get(id) ?? null
  }

  const normalized: SequenceEvent[] = []

  events.forEach((event) => {
    const eventType = (event as { eventType?: string }).eventType
    if (!eventType || !TONE_EVENT_TYPES.has(eventType)) return

    const nodeId = mapId((event as { nodeId?: unknown }).nodeId) ?? baseNodeId

    if (eventType === 'connect') {
      const rawConnectTo = (event as { connectTo?: unknown }).connectTo
      const connectTo =
        rawConnectTo === 'toDestination'
          ? monitorNodeId
          : rawConnectTo === MONITOR_NODE_ID
            ? monitorNodeId
            : rawConnectTo === monitorNodeId
              ? monitorNodeId
              : mapId(rawConnectTo) ?? monitorNodeId

      normalized.push({
        ...(event as SequenceEvent),
        nodeId,
        connectTo,
      } as SequenceEvent)
    } else {
      normalized.push({
        ...(event as SequenceEvent),
        nodeId,
      } as SequenceEvent)
    }
  })

  const instrumentTypes = new Set([
    'Synth',
    'AMSynth',
    'FMSynth',
    'MonoSynth',
    'DuoSynth',
    'MembraneSynth',
    'MetalSynth',
    'PluckSynth',
    'Sampler',
    'PolySynth',
  ])
  const instrumentCreate = normalized.find(
    (event) =>
      (event as { eventType?: string }).eventType === 'createNode' &&
      instrumentTypes.has((event as { nodeType?: string }).nodeType ?? ''),
  ) as { nodeId?: number } | undefined
  const firstCreate = normalized.find(
    (event) => (event as { eventType?: string }).eventType === 'createNode',
  ) as { nodeId?: number } | undefined
  const instrumentNodeId =
    typeof instrumentCreate?.nodeId === 'number'
      ? instrumentCreate.nodeId
      : typeof firstCreate?.nodeId === 'number'
        ? firstCreate.nodeId
        : idMap.values().next().value ?? baseNodeId
  return { events: normalized, instrumentNodeId }
}

async function applyMmlToToneState(group: Group, mmlText: string) {
  try {
    await ensureMmlReady()
    const parsed = mml2json(mmlText) as unknown as SequenceEvent[]
    const normalized = normalizeToneEvents(parsed, group)
    toneStates[group].events = normalized.events
    toneStates[group].instrumentNodeId = normalized.instrumentNodeId
    toneStates[group].jsonText = JSON.stringify(normalized.events, null, 2)
    toneStates[group].mmlText = mmlText
    toneStates[group].error = ''
  } catch (error) {
    console.error('Failed to convert MML', error)
    toneStates[group].error = 'MML parsing failed; using previous tone.'
  }
}

function applyJsonToToneState(group: Group, jsonText: string) {
  try {
    const parsed = JSON.parse(jsonText) as SequenceEvent[]
    const normalized = normalizeToneEvents(parsed, group)
    toneStates[group].events = normalized.events
    toneStates[group].instrumentNodeId = normalized.instrumentNodeId
    toneStates[group].jsonText = JSON.stringify(normalized.events, null, 2)
    toneStates[group].error = ''
  } catch (error) {
    console.error('Failed to parse tone JSON', error)
    toneStates[group].error = 'JSON parsing failed; using previous tone.'
  }
}

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
  const toneA = toneStates.A.events.length ? toneStates.A : buildFallbackToneConfig('A')
  const toneB = toneStates.B.events.length ? toneStates.B : buildFallbackToneConfig('B')
  const groupANodeId = toneA.instrumentNodeId
  const groupBNodeId = toneB.instrumentNodeId
  const noteEvents: SequenceEvent[] = []
  for (let step = 0; step < STEPS; step++) {
    noteEvents.push(
      {
        eventType: 'triggerAttackRelease',
        nodeId: groupANodeId,
        args: [midiToNoteName(noteNumbersA[step]), '16n', `+${startTicks[step]}i`],
      },
      {
        eventType: 'triggerAttackRelease',
        nodeId: groupBNodeId,
        args: [midiToNoteName(noteNumbersB[step]), '16n', `+${startTicks[step]}i`],
      },
    )
  }

  const ndjsonEvents: SequenceEvent[] = [
    ...toneA.events,
    ...toneB.events,
    ...noteEvents,
    {
      eventType: 'loopEnd',
      nodeId: groupANodeId,
      args: [`${loopTicks}i`],
    },
    {
      eventType: 'loopEnd',
      nodeId: groupBNodeId,
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

function setToneSectionOpen(group: Group, open: boolean) {
  const controls = toneControls[group]
  if (!controls) return
  toneStates[group].open = open
  controls.body.classList.toggle('collapsed', !open)
  if (open) {
    controls.body.removeAttribute('hidden')
  } else {
    controls.body.setAttribute('hidden', '')
  }
  controls.toggle.setAttribute('aria-expanded', open ? 'true' : 'false')
}

function updateToneStatus(group: Group) {
  const controls = toneControls[group]
  if (!controls) return
  const hasError = Boolean(toneStates[group].error)
  controls.status.textContent = hasError ? toneStates[group].error : 'Ready'
  controls.status.className = `tone-status ${hasError ? 'tone-status-error' : 'tone-status-ok'}`
}

function updateToneControls(group: Group) {
  const controls = toneControls[group]
  if (!controls) return
  controls.presetSelect.value = toneStates[group].presetId
  controls.mmlTextarea.value = toneStates[group].mmlText
  controls.jsonTextarea.value = toneStates[group].jsonText
  setToneSectionOpen(group, toneStates[group].open)
  updateToneStatus(group)
}

function toggleToneSection(group: Group) {
  setToneSectionOpen(group, !toneStates[group].open)
}

async function handleTonePresetChange(group: Group, presetId: string) {
  toneStates[group].presetId = presetId
  const preset = getPresetById(presetId)
  if (!preset) return
  toneStates[group].mmlText = preset.mml
  const controls = toneControls[group]
  if (controls) {
    controls.mmlTextarea.value = preset.mml
  }
  await handleToneMmlChange(group, preset.mml)
}

async function handleToneMmlChange(group: Group, mmlText: string) {
  await applyMmlToToneState(group, mmlText)
  updateToneControls(group)
  void applySequenceChange()
}

function handleToneJsonChange(group: Group, jsonText: string) {
  applyJsonToToneState(group, jsonText)
  updateToneControls(group)
  void applySequenceChange()
}

function renderToneControl(group: Group) {
  if (!noteGrid) return
  const section = document.createElement('div')
  section.className = 'tone-section'

  const header = document.createElement('div')
  header.className = 'tone-section-header'

  const toggle = document.createElement('button')
  toggle.type = 'button'
  toggle.className = 'tone-toggle'
  toggle.textContent = `Group ${group} Tone`
  toggle.setAttribute('aria-expanded', 'false')

  const status = document.createElement('span')
  status.className = 'tone-status tone-status-ok'
  status.textContent = 'Ready'

  header.appendChild(toggle)
  header.appendChild(status)
  section.appendChild(header)

  const body = document.createElement('div')
  body.className = 'tone-body collapsed'
  body.setAttribute('hidden', '')

  const presetLabel = document.createElement('label')
  presetLabel.className = 'field'
  const presetSpan = document.createElement('span')
  presetSpan.className = 'label'
  presetSpan.textContent = 'Tone preset (MML)'
  const presetSelect = document.createElement('select')
  presetSelect.className = 'text-input'
  tonePresets.forEach((preset) => {
    const option = document.createElement('option')
    option.value = preset.id
    option.textContent = preset.label
    presetSelect.appendChild(option)
  })
  presetLabel.appendChild(presetSpan)
  presetLabel.appendChild(presetSelect)
  body.appendChild(presetLabel)

  const mmlLabel = document.createElement('label')
  mmlLabel.className = 'field'
  const mmlSpan = document.createElement('span')
  mmlSpan.className = 'label'
  mmlSpan.textContent = 'MML edit'
  const mmlTextarea = document.createElement('textarea')
  mmlTextarea.className = 'text-input tone-textarea'
  mmlTextarea.rows = 4
  mmlLabel.appendChild(mmlSpan)
  mmlLabel.appendChild(mmlTextarea)
  body.appendChild(mmlLabel)

  const jsonLabel = document.createElement('label')
  jsonLabel.className = 'field'
  const jsonSpan = document.createElement('span')
  jsonSpan.className = 'label'
  jsonSpan.textContent = 'JSON edit'
  const jsonTextarea = document.createElement('textarea')
  jsonTextarea.className = 'text-input tone-textarea'
  jsonTextarea.rows = 4
  jsonLabel.appendChild(jsonSpan)
  jsonLabel.appendChild(jsonTextarea)
  body.appendChild(jsonLabel)

  section.appendChild(body)
  noteGrid.appendChild(section)

  toneControls[group] = { toggle, body, presetSelect, mmlTextarea, jsonTextarea, status }

  toggle.addEventListener('click', () => toggleToneSection(group))
  presetSelect.addEventListener('change', () => {
    void handleTonePresetChange(group, presetSelect.value)
  })
  mmlTextarea.addEventListener('change', () => {
    void handleToneMmlChange(group, mmlTextarea.value)
  })
  jsonTextarea.addEventListener('change', () => {
    handleToneJsonChange(group, jsonTextarea.value)
  })

  updateToneControls(group)
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
      renderToneControl(rowIndex === 0 ? 'A' : 'B')
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
const waveformCanvasA = document.querySelector<HTMLCanvasElement>('#waveform-a')
const fftCanvasA = document.querySelector<HTMLCanvasElement>('#fft-a')
const waveformCanvasB = document.querySelector<HTMLCanvasElement>('#waveform-b')
const fftCanvasB = document.querySelector<HTMLCanvasElement>('#fft-b')
const waveformCtxA = waveformCanvasA?.getContext('2d')
const fftCtxA = fftCanvasA?.getContext('2d')
const waveformCtxB = waveformCanvasB?.getContext('2d')
const fftCtxB = fftCanvasB?.getContext('2d')

renderNoteGrid()
buildSequenceFromNotes()
updateLoopNote()
updateNdjsonDisplay()

bpmInput?.addEventListener('change', () => handleBpmInputChange(bpmInput.value))

async function initializeTonePresets() {
  const groups: Group[] = ['A', 'B']
  for (const group of groups) {
    const preset = getPresetById(toneStates[group].presetId)
    if (preset) {
      toneStates[group].mmlText = preset.mml
    }
    updateToneControls(group)
    if (preset?.mml) {
      await applyMmlToToneState(group, preset.mml)
      updateToneControls(group)
    }
  }
  void applySequenceChange()
}

void initializeTonePresets()

const waveformAnalyserA = new Tone.Analyser('waveform', 1024)
const fftAnalyserA = new Tone.Analyser('fft', 128)
const waveformAnalyserB = new Tone.Analyser('waveform', 1024)
const fftAnalyserB = new Tone.Analyser('fft', 128)

let waveformSizeA: { width: number; height: number } = { width: 0, height: 0 }
let fftSizeA: { width: number; height: number } = { width: 0, height: 0 }
let waveformSizeB: { width: number; height: number } = { width: 0, height: 0 }
let fftSizeB: { width: number; height: number } = { width: 0, height: 0 }
let resizeTimeoutId: number | null = null
let monitorBusA: Tone.Gain | null = null
let monitorBusB: Tone.Gain | null = null
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

if (waveformCanvasA && fftCanvasA && waveformCtxA && fftCtxA &&
    waveformCanvasB && fftCanvasB && waveformCtxB && fftCtxB) {
  resizeCanvases()
  clearVisuals()
  window.addEventListener('resize', scheduleResize)
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

function drawGroupVisuals(
  waveformAnalyser: Tone.Analyser,
  fftAnalyser: Tone.Analyser,
  waveformCtx: CanvasRenderingContext2D,
  waveformCanvas: HTMLCanvasElement,
  waveformSize: { width: number; height: number },
  fftCtx: CanvasRenderingContext2D,
  fftCanvas: HTMLCanvasElement,
  fftSize: { width: number; height: number }
) {
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
    const magnitude = Math.max((value + FFT_NORMALIZATION_OFFSET) / FFT_NORMALIZATION_OFFSET, 0)
    const barHeight = magnitude * fftHeight
    const x = index * barWidth
    const y = fftHeight - barHeight
    fftCtx.fillRect(x, y, barWidth - 1, barHeight)
  })
}

function drawVisuals() {
  if (!waveformCtxA || !fftCtxA || !waveformCanvasA || !fftCanvasA ||
      !waveformCtxB || !fftCtxB || !waveformCanvasB || !fftCanvasB) return

  // Draw Group A
  drawGroupVisuals(
    waveformAnalyserA,
    fftAnalyserA,
    waveformCtxA,
    waveformCanvasA,
    waveformSizeA,
    fftCtxA,
    fftCanvasA,
    fftSizeA
  )

  // Draw Group B
  drawGroupVisuals(
    waveformAnalyserB,
    fftAnalyserB,
    waveformCtxB,
    waveformCanvasB,
    waveformSizeB,
    fftCtxB,
    fftCanvasB,
    fftSizeB
  )

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
    monitorBusA = null
    monitorBusB = null
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
