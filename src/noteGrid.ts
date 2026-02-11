import * as Tone from 'tone'
import type { SequenceEvent } from 'tonejs-json-sequencer'
import {
  DEFAULT_BPM,
  DEFAULT_MIDI_NOTE,
  DEFAULT_NOTE_ROWS,
  GROUP_SIZE,
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

let noteGrid: HTMLDivElement | null = null
let ndjsonElement: HTMLTextAreaElement | null = null
let loopNoteElement: HTMLParagraphElement | null = null
let bpmInput: HTMLInputElement | null = null
let ndjsonInputTimeout: number | null = null
const rowNoteInputTimeouts: Array<number | null> = []
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

function buildTimingMap() {
  const startTicks: number[] = []
  let tickCursor = 0
  for (let step = 0; step < STEPS; step++) {
    startTicks.push(Math.round(tickCursor))
    tickCursor += getStepTicks(step)
  }
  return { startTicks, loopTicks: Math.round(tickCursor) }
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
}
