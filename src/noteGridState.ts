import { DEFAULT_MIDI_NOTE, DEFAULT_NOTE_ROWS, GROUP_SIZE, STEPS, type Group } from './constants'
import { clampMidi, midiToNoteName, noteNameToMidi } from './noteGridUtils'

export type StepState = 'note' | 'rest' | 'tie'
export type SequenceChangeHandler = () => Promise<void>

export const GROUP_A_MIN_MIDI = 48
export const GROUP_A_MAX_MIDI = 72
export const GROUP_B_MIN_MIDI = 24
export const GROUP_B_MAX_MIDI = 36

export const stepStates: StepState[] = Array.from({ length: STEPS }, () => 'note' as StepState)

export const rowNoteNames: string[] = [...DEFAULT_NOTE_ROWS]
export const selectedRowsA = Array.from({ length: STEPS }, () => 1)
export const selectedRowsB = Array.from({ length: STEPS }, () => GROUP_SIZE + 1)
export const noteNumbersA = selectedRowsA.map((row) => noteNameToMidi(rowNoteNames[row]))
export const noteNumbersB = selectedRowsB.map((row) => noteNameToMidi(rowNoteNames[row]))

export const gridCells: HTMLButtonElement[][] = []
export const stepLabels: HTMLSpanElement[] = []
export const rowInputs: HTMLInputElement[] = []

export function setStepState(step: number, state: StepState) {
  if (step >= 0 && step < STEPS) {
    stepStates[step] = state
  }
}

export function resetStepStates() {
  stepStates.fill('note')
}

export function getStepStates(): readonly StepState[] {
  return stepStates
}

export function getGroupANoteNumbers(): readonly number[] {
  return noteNumbersA
}

export function rowIndexToGroup(rowIndex: number): Group {
  return rowIndex < GROUP_SIZE ? 'A' : 'B'
}

export function getSelections(group: Group) {
  return group === 'A' ? selectedRowsA : selectedRowsB
}

export function getNoteNumbers(group: Group) {
  return group === 'A' ? noteNumbersA : noteNumbersB
}

export function updateNoteNumbersForRow(rowIndex: number, midiValue: number) {
  const group = rowIndexToGroup(rowIndex)
  const selections = getSelections(group)
  const notes = getNoteNumbers(group)
  selections.forEach((selectedRow, stepIndex) => {
    if (selectedRow === rowIndex) {
      notes[stepIndex] = midiValue
    }
  })
}

export function updateRowCellLabels(rowIndex: number) {
  const noteName = rowNoteNames[rowIndex]
  gridCells[rowIndex]?.forEach((cell, stepIndex) => {
    cell.setAttribute('aria-label', `Step ${stepIndex + 1}, row ${rowIndex + 1} (${noteName})`)
  })
}

export function updateGridActiveStates() {
  gridCells.forEach((cells, rowIndex) => {
    const selections = getSelections(rowIndexToGroup(rowIndex))
    cells.forEach((cell, stepIndex) => {
      const active = selections[stepIndex] === rowIndex
      cell.classList.toggle('active', active)
      cell.setAttribute('aria-pressed', active ? 'true' : 'false')
    })
  })
}

export function updateStepLabelStates() {
  stepLabels.forEach((label, step) => {
    const state = stepStates[step]
    label.classList.toggle('rest', state === 'rest')
    label.classList.toggle('tie', state === 'tie')
    label.setAttribute('aria-label', `Step ${step + 1}: ${state} (click to cycle)`)
  })
}

export function applyRowMidis(rowIndices: number[], midiValues: number[]) {
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
