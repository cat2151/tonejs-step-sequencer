import { GROUP_SIZE, STEPS } from './constants'
import {
  clampMidi,
  collectScaleNotes,
  findPreviousScaleNote,
  noteNameToMidi,
  pickKeyIndex,
  pickScaleIntervals,
  pickUniqueNotes,
} from './noteGridUtils'
import {
  applyRowMidis,
  noteNumbersA,
  noteNumbersB,
  rowNoteNames,
  selectedRowsA,
  selectedRowsB,
  stepStates,
  updateGridActiveStates,
  updateStepLabelStates,
  type SequenceChangeHandler,
  GROUP_A_MIN_MIDI,
  GROUP_A_MAX_MIDI,
  GROUP_B_MIN_MIDI,
  GROUP_B_MAX_MIDI,
} from './noteGridState'

function randomizeStepStates() {
  stepStates.fill('note')
  for (let step = 0; step < STEPS; step++) {
    const r = Math.random()
    if (r < 0.2) {
      stepStates[step] = 'rest'
    } else if (r < 0.4) {
      // Tie is valid only if: not the first step, previous step is not rest, and pitches match
      if (step > 0 && stepStates[step - 1] !== 'rest' && noteNumbersA[step] === noteNumbersA[step - 1]) {
        stepStates[step] = 'tie'
      }
    }
  }
}

function postProcessGroupAStates() {
  const maxIterations = STEPS * 2
  let iterations = 0
  let changed = true
  while (changed && iterations < maxIterations) {
    changed = false
    iterations++
    for (let step = 0; step < STEPS - 1; step++) {
      if (
        stepStates[step] === 'note' &&
        stepStates[step + 1] === 'note' &&
        noteNumbersA[step] === noteNumbersA[step + 1]
      ) {
        stepStates[step + 1] = Math.random() < 0.5 ? 'tie' : 'rest'
        changed = true
      }
    }
  }
  // Fix any tie that follows a rest (can occur when postProcessGroupAStates changes a note to
  // rest while the subsequent step was already set to tie by randomizeStepStates)
  for (let step = 1; step < STEPS; step++) {
    if (stepStates[step] === 'tie' && stepStates[step - 1] === 'rest') {
      stepStates[step] = 'note'
    }
  }
}

export function randomizeRowPitches(
  onSequenceChange: SequenceChangeHandler,
  triggerSequenceChange = true,
  updateActiveState = true,
) {
  const scaleIntervals = pickScaleIntervals()
  const keyIndex = pickKeyIndex()

  const groupARows = Array.from({ length: GROUP_SIZE }, (_, i) => i)
  const groupAScaleNotes = collectScaleNotes(GROUP_A_MIN_MIDI, GROUP_A_MAX_MIDI, keyIndex, scaleIntervals)
  const pickedA = pickUniqueNotes(groupAScaleNotes, GROUP_SIZE)
  while (pickedA.length < GROUP_SIZE && groupAScaleNotes.length) {
    pickedA.push(groupAScaleNotes[pickedA.length % groupAScaleNotes.length]!)
  }
  applyRowMidis(groupARows, pickedA.sort((a, b) => b - a))

  const groupBRows = Array.from({ length: GROUP_SIZE }, (_, i) => GROUP_SIZE + i)
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
      : groupBRows.map((row) => noteNameToMidi(rowNoteNames[row]))
  }
  applyRowMidis(groupBRows, groupBMidis)

  if (updateActiveState) {
    updateGridActiveStates()
  }
  if (triggerSequenceChange) {
    void onSequenceChange()
  }
}

export function randomizeGridSelections(
  onSequenceChange: SequenceChangeHandler,
  triggerSequenceChange = true,
  updateActiveState = true,
) {
  const groupARowMidis = Array.from({ length: GROUP_SIZE }, (_, i) => noteNameToMidi(rowNoteNames[i]))
  for (let step = 0; step < STEPS; step++) {
    const rowIndex = Math.floor(Math.random() * GROUP_SIZE)
    selectedRowsA[step] = rowIndex
    noteNumbersA[step] = groupARowMidis[rowIndex] ?? noteNumbersA[step]
  }

  const groupBRowMidis = Array.from({ length: GROUP_SIZE }, (_, i) => noteNameToMidi(rowNoteNames[GROUP_SIZE + i]))
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

  // Randomize step states after grid selections are set (noteNumbersA is updated above)
  randomizeStepStates()
  postProcessGroupAStates()

  if (updateActiveState) {
    updateGridActiveStates()
    updateStepLabelStates()
  }
  if (triggerSequenceChange) {
    void onSequenceChange()
  }
}

export function randomizeAll(onSequenceChange: SequenceChangeHandler) {
  randomizeRowPitches(onSequenceChange, false, false)
  randomizeGridSelections(onSequenceChange, false, false)
  updateGridActiveStates()
  updateStepLabelStates()
  return onSequenceChange()
}
