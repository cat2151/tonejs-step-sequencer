import * as Tone from 'tone'
import type { SequenceEvent } from 'tonejs-json-sequencer'
import {
  DEFAULT_MIDI_NOTE,
  GROUP_SIZE,
  STEPS,
  type Group,
} from './constants'
import {
  clampBpm,
  midiToNoteName,
  noteNameToMidi,
} from './noteGridUtils'
import {
  bpmMap,
  buildTimingMap,
  getBpmValue,
  setBpmValue,
} from './noteGridTiming'
export {
  getLoopDurationSeconds,
  getCurrentStep,
  getCurrentStepFromSeconds,
} from './noteGridTiming'
import { renderToneControl } from './toneControls'
import { buildFallbackToneConfig, toneStates } from './toneState'
import {
  getNoteNumbers,
  getSelections,
  gridCells,
  noteNumbersA,
  noteNumbersB,
  rowInputs,
  rowNoteNames,
  rowIndexToGroup,
  stepLabels,
  stepStates,
  updateGridActiveStates,
  updateNoteNumbersForRow,
  updateRowCellLabels,
  updateStepLabelStates,
  type SequenceChangeHandler,
} from './noteGridState'
export { setStepState, resetStepStates, getStepStates, getGroupANoteNumbers, type StepState } from './noteGridState'
import {
  randomizeAll as _randomizeAll,
  randomizeGridSelections,
  randomizeRowPitches,
} from './noteGridRandomize'

type NdjsonChangeHandler = () => Promise<void>

let ndjsonSequence = ''

let noteGrid: HTMLDivElement | null = null
let ndjsonElement: HTMLTextAreaElement | null = null
let loopNoteElement: HTMLParagraphElement | null = null
let bpmInput: HTMLInputElement | null = null
let ndjsonInputTimeout: number | null = null
let bpmInputTimeout: number | null = null
const rowNoteInputTimeouts: Array<number | null> = []
let currentPlayingStep: number | null = null
let isDragging = false
let dragRowIndex: number | null = null
let pendingChangeHandler: SequenceChangeHandler | null = null
let mouseUpListenerAdded = false

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

export function getStepFrequency(group: Group, step: number): number {
  const notes = getNoteNumbers(group)
  const midi = notes[step] ?? DEFAULT_MIDI_NOTE
  const safeMidi = Number.isFinite(midi) ? midi : DEFAULT_MIDI_NOTE
  return Tone.Frequency(safeMidi, 'midi').toFrequency()
}

function computeNoteDurationTicks(startStep: number, startTicks: number[], loopTicks: number): number {
  for (let i = startStep + 1; i < STEPS; i++) {
    if (stepStates[i] !== 'tie') {
      return (startTicks[i] ?? 0) - (startTicks[startStep] ?? 0)
    }
  }
  // Ties run to the end of the loop
  return loopTicks - (startTicks[startStep] ?? 0)
}

export function buildSequenceFromNotes() {
  const { startTicks, loopTicks } = buildTimingMap()
  const toneA = toneStates.A.events.length ? toneStates.A : buildFallbackToneConfig('A')
  const toneB = toneStates.B.events.length ? toneStates.B : buildFallbackToneConfig('B')
  const groupANodeId = toneA.instrumentNodeId
  const groupBNodeId = toneB.instrumentNodeId
  const noteEvents: SequenceEvent[] = []
  for (let step = 0; step < STEPS; step++) {
    // Rests and ties apply only to Group A
    if (stepStates[step] !== 'rest' && stepStates[step] !== 'tie') {
      const durationTicks = computeNoteDurationTicks(step, startTicks, loopTicks)
      noteEvents.push({
        eventType: 'triggerAttackRelease',
        nodeId: groupANodeId,
        args: [midiToNoteName(noteNumbersA[step]), `${durationTicks}i`, `+${startTicks[step]}i`],
      })
    }
    // Group B always plays; rests and ties do not affect it
    const durationTicksB = (startTicks[step + 1] ?? loopTicks) - startTicks[step]
    noteEvents.push({
      eventType: 'triggerAttackRelease',
      nodeId: groupBNodeId,
      args: [midiToNoteName(noteNumbersB[step]), `${durationTicksB}i`, `+${startTicks[step]}i`],
    })
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

export function setPlayingStep(step: number | null): void {
  if (currentPlayingStep === step) return
  if (currentPlayingStep !== null) {
    const prev = currentPlayingStep
    stepLabels[prev]?.classList.remove('playing')
    gridCells.forEach((cells) => {
      cells[prev]?.classList.remove('playing')
    })
  }
  currentPlayingStep = step
  if (step !== null) {
    stepLabels[step]?.classList.add('playing')
    gridCells.forEach((cells) => {
      cells[step]?.classList.add('playing')
    })
  }
}

export function updateLoopNote() {
  if (loopNoteElement) {
    loopNoteElement.textContent = `Loop runs at ${getBpmValue()} BPM with a 16-step 16n sequence and explicit loop boundary.`
  }
}

export function updateNdjsonDisplay() {
  if (ndjsonElement) {
    ndjsonElement.value = ndjsonSequence
  }
}

function applyStepState(stepIndex: number, rowIndex: number) {
  const group = rowIndexToGroup(rowIndex)
  const selections = getSelections(group)
  const notes = getNoteNumbers(group)
  selections[stepIndex] = rowIndex
  notes[stepIndex] = noteNameToMidi(rowNoteNames[rowIndex])
  updateGridActiveStates()
}

function handleStepSelection(stepIndex: number, rowIndex: number, onSequenceChange: SequenceChangeHandler) {
  applyStepState(stepIndex, rowIndex)
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
  setBpmValue(bpm)
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

function scheduleBpmInputChange(value: string, onSequenceChange: SequenceChangeHandler) {
  if (bpmInputTimeout !== null) {
    window.clearTimeout(bpmInputTimeout)
  }
  bpmInputTimeout = window.setTimeout(() => {
    bpmInputTimeout = null
    handleBpmInputChange(value, onSequenceChange)
  }, 1500)
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

export function randomizeAll(onSequenceChange: SequenceChangeHandler) {
  return _randomizeAll(onSequenceChange)
}

function cycleStepState(step: number, onSequenceChange: SequenceChangeHandler) {
  const current = stepStates[step]
  stepStates[step] = current === 'note' ? 'rest' : current === 'rest' ? 'tie' : 'note'
  updateStepLabelStates()
  void onSequenceChange()
}

function renderNoteGrid(onSequenceChange: SequenceChangeHandler) {
  if (!noteGrid) return
  const grid = noteGrid
  grid.innerHTML = ''
  gridCells.length = 0
  rowInputs.length = 0
  stepLabels.length = 0

  const headerRow = document.createElement('div')
  headerRow.className = 'note-grid-row note-grid-header'
  const spacer = document.createElement('div')
  spacer.className = 'note-row-label'
  headerRow.appendChild(spacer)
  for (let step = 0; step < STEPS; step++) {
    const stepLabel = document.createElement('span')
    stepLabel.className = 'note-step-label'
    stepLabel.textContent = `${step + 1}`
    stepLabel.setAttribute('role', 'button')
    stepLabel.setAttribute('tabindex', '0')
    stepLabel.setAttribute('title', 'Click to cycle: note / rest / tie')
    stepLabel.setAttribute('aria-label', `Step ${step + 1}: note (click to cycle)`)
    stepLabel.addEventListener('click', () => cycleStepState(step, onSequenceChange))
    stepLabel.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault()
        cycleStepState(step, onSequenceChange)
      }
    })
    stepLabels.push(stepLabel)
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
      cell.addEventListener('mousedown', (e) => {
        if (e.button !== 0) return
        isDragging = true
        dragRowIndex = rowIndex
        pendingChangeHandler = onSequenceChange
        applyStepState(step, rowIndex)
      })
      cell.addEventListener('mouseenter', (e) => {
        if (isDragging && dragRowIndex === rowIndex && (e.buttons & 1) !== 0) {
          applyStepState(step, rowIndex)
        }
      })
      cell.addEventListener('click', (e) => {
        // detail === 0 means keyboard activation (Enter/Space); mouse clicks have detail >= 1
        if (e.detail === 0) {
          handleStepSelection(step, rowIndex, onSequenceChange)
        }
      })
      rowElement.appendChild(cell)
      cells.push(cell)
    }

    gridCells[rowIndex] = cells
    grid.appendChild(rowElement)
  })

  updateGridActiveStates()
  updateStepLabelStates()
}

export function initializeNoteGrid(onSequenceChange: SequenceChangeHandler, onNdjsonChange: NdjsonChangeHandler) {
  noteGrid = document.querySelector<HTMLDivElement>('#note-grid')
  ndjsonElement = document.querySelector<HTMLTextAreaElement>('#ndjson')
  loopNoteElement = document.querySelector<HTMLParagraphElement>('#loop-note')
  bpmInput = document.querySelector<HTMLInputElement>('#bpm-input')

  if (!mouseUpListenerAdded) {
    mouseUpListenerAdded = true
    document.addEventListener('mouseup', () => {
      if (isDragging && pendingChangeHandler) {
        void pendingChangeHandler()
        pendingChangeHandler = null
      }
      isDragging = false
      dragRowIndex = null
    })
  }

  renderNoteGrid(onSequenceChange)
  buildSequenceFromNotes()
  updateLoopNote()
  updateNdjsonDisplay()

  if (bpmInput) {
    const input = bpmInput
    input.addEventListener('input', () => scheduleBpmInputChange(input.value, onSequenceChange))
    input.addEventListener('change', () => {
      if (bpmInputTimeout !== null) {
        window.clearTimeout(bpmInputTimeout)
        bpmInputTimeout = null
      }
      handleBpmInputChange(input.value, onSequenceChange)
    })
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

