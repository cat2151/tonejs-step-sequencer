import * as Tone from 'tone'
import type { SequenceEvent } from 'tonejs-json-sequencer'
import {
  DEFAULT_BPM,
  DEFAULT_MIDI_NOTE,
  DEFAULT_NOTE_ROWS,
  GROUP_SIZE,
  PPQ,
  SIXTEENTH_TICKS,
  STEPS,
  type Group,
} from './constants'
import { renderToneControl } from './toneControls'
import { buildFallbackToneConfig, toneStates } from './toneState'

type SequenceChangeHandler = () => Promise<void>
type NdjsonChangeHandler = () => Promise<void>

const rowNoteNames: string[] = [...DEFAULT_NOTE_ROWS]
const selectedRowsA = Array.from({ length: STEPS }, () => 1)
const selectedRowsB = Array.from({ length: STEPS }, () => GROUP_SIZE + 1)
const noteNumbersA = selectedRowsA.map((row) => noteNameToMidi(rowNoteNames[row]))
const noteNumbersB = selectedRowsB.map((row) => noteNameToMidi(rowNoteNames[row]))
let bpmValue = DEFAULT_BPM
let ndjsonSequence = ''
const bpmMap = Array.from({ length: STEPS }, () => DEFAULT_BPM)
let loopTicksCache = 0
let loopSecondsCache = 0

let noteGrid: HTMLDivElement | null = null
let ndjsonElement: HTMLTextAreaElement | null = null
let loopNoteElement: HTMLParagraphElement | null = null
let bpmInput: HTMLInputElement | null = null
let ndjsonInputTimeout: number | null = null
const rowNoteInputTimeouts: Array<number | null> = []
const rowInputs: HTMLInputElement[] = []
const gridCells: HTMLButtonElement[][] = []
const KEY_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
const MINOR_PENTATONIC_INTERVALS = [0, 3, 5, 7, 10]
const CHROMATIC_INTERVALS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]
const GROUP_A_MIN_MIDI = 48
const GROUP_A_MAX_MIDI = 72
const GROUP_B_MIN_MIDI = 24
const GROUP_B_MAX_MIDI = 36

function clampMidi(value: number) {
  if (!Number.isFinite(value)) return DEFAULT_MIDI_NOTE
  return Math.min(127, Math.max(0, Math.round(value)))
}

function clampBpm(value: number) {
  if (!Number.isFinite(value)) return DEFAULT_BPM
  return Math.min(300, Math.max(1, Math.round(value)))
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

export function getGroupMinFrequency(group: Group) {
  const notes = getNoteNumbers(group)
  let minMidi = Infinity
  notes.forEach((note) => {
    if (Number.isFinite(note)) {
      minMidi = Math.min(minMidi, note)
    }
  })
  const midiValue = Number.isFinite(minMidi) ? minMidi : DEFAULT_MIDI_NOTE
  return Tone.Frequency(midiValue, 'midi').toFrequency()
}

function getStepBpm(stepIndex: number) {
  return clampBpm(bpmMap[stepIndex] ?? DEFAULT_BPM)
}

function getStepTicks(stepIndex: number) {
  return SIXTEENTH_TICKS * (DEFAULT_BPM / getStepBpm(stepIndex))
}

function pickScaleIntervals() {
  return Math.random() < 0.05 ? CHROMATIC_INTERVALS : MINOR_PENTATONIC_INTERVALS
}

function pickKeyIndex() {
  return Math.floor(Math.random() * KEY_NAMES.length)
}

function isNoteInScale(midi: number, keyIndex: number, intervals: number[]) {
  const interval = ((midi - keyIndex) % 12 + 12) % 12
  return intervals.includes(interval)
}

function collectScaleNotes(minMidi: number, maxMidi: number, keyIndex: number, intervals: number[]) {
  const notes: number[] = []
  for (let midi = minMidi; midi <= maxMidi; midi++) {
    if (isNoteInScale(midi, keyIndex, intervals)) {
      notes.push(midi)
    }
  }
  return notes
}

function pickUniqueNotes(source: number[], count: number) {
  const pool = [...source]
  const picked: number[] = []
  while (picked.length < count && pool.length) {
    const index = Math.floor(Math.random() * pool.length)
    picked.push(pool[index]!)
    pool.splice(index, 1)
  }
  return picked
}

function findPreviousScaleNote(startMidi: number, keyIndex: number, intervals: number[]) {
  for (let midi = startMidi - 1; midi >= 0 && midi >= startMidi - 24; midi--) {
    if (isNoteInScale(midi, keyIndex, intervals)) {
      return midi
    }
  }
  return startMidi
}

function applyRowMidis(rowIndices: number[], midiValues: number[]) {
  rowIndices.forEach((rowIndex, midiIndex) => {
    const midi = clampMidi(midiValues[midiIndex] ?? midiValues[midiValues.length - 1] ?? DEFAULT_MIDI_NOTE)
    const noteName = midiToNoteName(midi)
    rowNoteNames[rowIndex] = noteName
    if (rowInputs[rowIndex]) {
      rowInputs[rowIndex].value = noteName
    }
    updateNoteNumbersForRow(rowIndex, midi)
    updateRowCellLabels(rowIndex)
  })
}

function buildTimingMap() {
  const startTicks: number[] = []
  let tickCursor = 0
  for (let step = 0; step < STEPS; step++) {
    startTicks.push(Math.round(tickCursor))
    tickCursor += getStepTicks(step)
  }
  loopTicksCache = Math.round(tickCursor)
  loopSecondsCache = ticksToSeconds(loopTicksCache)
  return { startTicks, loopTicks: loopTicksCache }
}

function ticksToSeconds(loopTicks: number) {
  const bpm = Tone.Transport.bpm?.value ?? DEFAULT_BPM
  const secondsPerTick = (60 / bpm) / PPQ
  return loopTicks * secondsPerTick
}

export function buildSequenceFromNotes() {
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

export function getNdjsonSequence() {
  return ndjsonSequence
}

export function getLoopDurationSeconds() {
  if (!Number.isFinite(loopSecondsCache) || loopSecondsCache <= 0) {
    loopSecondsCache = ticksToSeconds(loopTicksCache || buildTimingMap().loopTicks)
  }
  return loopSecondsCache
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

export function updateLoopNote() {
  if (loopNoteElement) {
    loopNoteElement.textContent = `Loop runs at ${bpmValue} BPM with a 16-step 16n sequence and explicit loop boundary.`
  }
}

export function updateNdjsonDisplay() {
  if (ndjsonElement) {
    ndjsonElement.value = ndjsonSequence
  }
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

function handleStepSelection(stepIndex: number, rowIndex: number, onSequenceChange: SequenceChangeHandler) {
  const group = rowIndexToGroup(rowIndex)
  const selections = getSelections(group)
  const notes = getNoteNumbers(group)
  selections[stepIndex] = rowIndex
  notes[stepIndex] = noteNameToMidi(rowNoteNames[rowIndex])
  updateGridActiveStates()
  void onSequenceChange()
}

function handleRowNoteInputChange(rowIndex: number, value: string, onSequenceChange: SequenceChangeHandler) {
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
  void onSequenceChange()
}

function handleBpmInputChange(value: string, onSequenceChange: SequenceChangeHandler) {
  const parsed = Number.parseFloat(value)
  const bpm = clampBpm(parsed)
  bpmValue = bpm
  if (bpmInput) {
    bpmInput.value = `${bpm}`
  }
  bpmMap.fill(bpm)
  updateLoopNote()
  void onSequenceChange()
}

function handleNdjsonChange(value: string, onNdjsonChange: NdjsonChangeHandler) {
  ndjsonSequence = value
  void onNdjsonChange()
}

function scheduleNdjsonChange(text: string, onNdjsonChange: NdjsonChangeHandler) {
  if (ndjsonInputTimeout !== null) {
    window.clearTimeout(ndjsonInputTimeout)
  }
  ndjsonInputTimeout = window.setTimeout(() => {
    ndjsonInputTimeout = null
    handleNdjsonChange(text, onNdjsonChange)
  }, 350)
}

function scheduleRowNoteInputChange(
  rowIndex: number,
  value: string,
  onSequenceChange: SequenceChangeHandler,
) {
  if (rowNoteInputTimeouts[rowIndex] !== null) {
    window.clearTimeout(rowNoteInputTimeouts[rowIndex]!)
  }
  rowNoteInputTimeouts[rowIndex] = window.setTimeout(() => {
    rowNoteInputTimeouts[rowIndex] = null
    handleRowNoteInputChange(rowIndex, value, onSequenceChange)
  }, 300)
}

function randomizeRowPitches(
  onSequenceChange: SequenceChangeHandler,
  triggerSequenceChange = true,
  updateActiveState = true,
) {
  const scaleIntervals = pickScaleIntervals()
  const keyIndex = pickKeyIndex()

  const groupAScaleNotes = collectScaleNotes(GROUP_A_MIN_MIDI, GROUP_A_MAX_MIDI, keyIndex, scaleIntervals)
  const pickedA = pickUniqueNotes(groupAScaleNotes, GROUP_SIZE)
  while (pickedA.length < GROUP_SIZE && groupAScaleNotes.length) {
    pickedA.push(groupAScaleNotes[pickedA.length % groupAScaleNotes.length]!)
  }
  applyRowMidis([0, 1, 2], pickedA.sort((a, b) => b - a))

  const groupBScaleNotes = collectScaleNotes(GROUP_B_MIN_MIDI, GROUP_B_MAX_MIDI, keyIndex, scaleIntervals)
  const useRootPattern = Math.random() < 0.5
  let groupBMidis: number[]
  if (useRootPattern && groupBScaleNotes.length) {
    const root = groupBScaleNotes[Math.floor(Math.random() * groupBScaleNotes.length)]!
    const lower = findPreviousScaleNote(root, keyIndex, scaleIntervals)
    const octaveUp = clampMidi(root + 12)
    groupBMidis = [octaveUp, lower, root]
  } else {
    const pickedB = pickUniqueNotes(groupBScaleNotes, GROUP_SIZE)
    while (pickedB.length < GROUP_SIZE && groupBScaleNotes.length) {
      pickedB.push(groupBScaleNotes[pickedB.length % groupBScaleNotes.length]!)
    }
    groupBMidis = pickedB.length
      ? pickedB.sort((a, b) => b - a)
      : [noteNameToMidi(rowNoteNames[3]), noteNameToMidi(rowNoteNames[4]), noteNameToMidi(rowNoteNames[5])]
  }
  applyRowMidis([3, 4, 5], groupBMidis)

  if (updateActiveState) {
    updateGridActiveStates()
  }
  if (triggerSequenceChange) {
    void onSequenceChange()
  }
}

function randomizeGridSelections(
  onSequenceChange: SequenceChangeHandler,
  triggerSequenceChange = true,
  updateActiveState = true,
) {
  const groupARowMidis = [0, 1, 2].map((row) => noteNameToMidi(rowNoteNames[row]))
  for (let step = 0; step < STEPS; step++) {
    const rowIndex = Math.floor(Math.random() * GROUP_SIZE)
    selectedRowsA[step] = rowIndex
    noteNumbersA[step] = groupARowMidis[rowIndex] ?? noteNumbersA[step]
  }

  const groupBRowMidis = [0, 1, 2].map((row) => noteNameToMidi(rowNoteNames[GROUP_SIZE + row]))
  const useSparsePattern = Math.random() < 0.5
  for (let step = 0; step < STEPS; step++) {
    if (useSparsePattern) {
      selectedRowsB[step] = GROUP_SIZE + 2
      noteNumbersB[step] = groupBRowMidis[2] ?? noteNumbersB[step]
      if (Math.random() < 0.35) {
        const altIndex = Math.random() < 0.5 ? 0 : 1
        selectedRowsB[step] = GROUP_SIZE + altIndex
        noteNumbersB[step] = groupBRowMidis[altIndex] ?? noteNumbersB[step]
      }
    } else {
      const rowIndex = Math.floor(Math.random() * GROUP_SIZE)
      selectedRowsB[step] = GROUP_SIZE + rowIndex
      noteNumbersB[step] = groupBRowMidis[rowIndex] ?? noteNumbersB[step]
    }
  }

  if (updateActiveState) {
    updateGridActiveStates()
  }
  if (triggerSequenceChange) {
    void onSequenceChange()
  }
}

export function randomizeAll(onSequenceChange: SequenceChangeHandler) {
  randomizeRowPitches(onSequenceChange, false, false)
  randomizeGridSelections(onSequenceChange, false, false)
  updateGridActiveStates()
  return onSequenceChange()
}

function renderNoteGrid(onSequenceChange: SequenceChangeHandler) {
  if (!noteGrid) return
  const grid = noteGrid
  grid.innerHTML = ''
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
  grid.appendChild(headerRow)

  rowNoteNames.forEach((noteName, rowIndex) => {
    if (rowIndex === 0 || rowIndex === GROUP_SIZE) {
      renderToneControl(rowIndex === 0 ? 'A' : 'B', grid, onSequenceChange)
      const groupLabel = document.createElement('p')
      groupLabel.className = 'group-label'
      groupLabel.textContent = rowIndex === 0 ? 'Group A' : 'Group B'
      grid.appendChild(groupLabel)
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
    rowNoteInputTimeouts[rowIndex] = null
    input.addEventListener('input', () =>
      scheduleRowNoteInputChange(rowIndex, input.value, onSequenceChange),
    )
    input.addEventListener('change', () => {
      if (rowNoteInputTimeouts[rowIndex] !== null) {
        window.clearTimeout(rowNoteInputTimeouts[rowIndex]!)
        rowNoteInputTimeouts[rowIndex] = null
      }
      handleRowNoteInputChange(rowIndex, input.value, onSequenceChange)
    })
    labelWrapper.appendChild(input)
    rowInputs[rowIndex] = input
    rowElement.appendChild(labelWrapper)

    const cells: HTMLButtonElement[] = []
    for (let step = 0; step < STEPS; step++) {
      const cell = document.createElement('button')
      cell.type = 'button'
      cell.className = 'note-cell'
      cell.setAttribute('aria-label', `Step ${step + 1}, row ${rowIndex + 1} (${noteName})`)
      cell.addEventListener('click', () => handleStepSelection(step, rowIndex, onSequenceChange))
      rowElement.appendChild(cell)
      cells.push(cell)
    }

    gridCells[rowIndex] = cells
    grid.appendChild(rowElement)
  })

  updateGridActiveStates()
}

export function initializeNoteGrid(onSequenceChange: SequenceChangeHandler, onNdjsonChange: NdjsonChangeHandler) {
  noteGrid = document.querySelector<HTMLDivElement>('#note-grid')
  ndjsonElement = document.querySelector<HTMLTextAreaElement>('#ndjson')
  loopNoteElement = document.querySelector<HTMLParagraphElement>('#loop-note')
  bpmInput = document.querySelector<HTMLInputElement>('#bpm-input')

  renderNoteGrid(onSequenceChange)
  buildSequenceFromNotes()
  updateLoopNote()
  updateNdjsonDisplay()

  if (bpmInput) {
    const input = bpmInput
    input.addEventListener('change', () => handleBpmInputChange(input.value, onSequenceChange))
  }

  if (ndjsonElement) {
    const textarea = ndjsonElement
    textarea.addEventListener('input', () => scheduleNdjsonChange(textarea.value, onNdjsonChange))
    textarea.addEventListener('change', () => handleNdjsonChange(textarea.value, onNdjsonChange))
  }

  const randomPitchButton = document.querySelector<HTMLButtonElement>('#random-pitch')
  randomPitchButton?.addEventListener('click', () => randomizeRowPitches(onSequenceChange))

  const randomGridButton = document.querySelector<HTMLButtonElement>('#random-grid')
  randomGridButton?.addEventListener('click', () => randomizeGridSelections(onSequenceChange))
}
