import * as Tone from 'tone'
import { DEFAULT_BPM, DEFAULT_MIDI_NOTE } from './constants'

const KEY_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
const MINOR_PENTATONIC_INTERVALS = [0, 3, 5, 7, 10]
const CHROMATIC_INTERVALS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]

export function clampMidi(value: number) {
  if (!Number.isFinite(value)) return DEFAULT_MIDI_NOTE
  return Math.min(127, Math.max(0, Math.round(value)))
}

export function clampBpm(value: number) {
  if (!Number.isFinite(value)) return DEFAULT_BPM
  return Math.min(300, Math.max(1, Math.round(value)))
}

export function midiToNoteName(midi: number) {
  return Tone.Frequency(midi, 'midi').toNote()
}

export function noteNameToMidi(noteName: string, fallbackMidi: number = DEFAULT_MIDI_NOTE) {
  try {
    const midi = Tone.Frequency(noteName).toMidi()
    if (!Number.isFinite(midi)) return clampMidi(fallbackMidi)
    return clampMidi(midi)
  } catch (error) {
    console.warn('Invalid note name; reverting to fallback MIDI note.', noteName, error)
    return clampMidi(fallbackMidi)
  }
}

export function pickScaleIntervals() {
  return Math.random() < 0.05 ? CHROMATIC_INTERVALS : MINOR_PENTATONIC_INTERVALS
}

export function pickKeyIndex() {
  return Math.floor(Math.random() * KEY_NAMES.length)
}

export function isNoteInScale(midi: number, keyIndex: number, intervals: number[]) {
  const interval = ((midi - keyIndex) % 12 + 12) % 12
  return intervals.includes(interval)
}

export function collectScaleNotes(minMidi: number, maxMidi: number, keyIndex: number, intervals: number[]) {
  const notes: number[] = []
  for (let midi = minMidi; midi <= maxMidi; midi++) {
    if (isNoteInScale(midi, keyIndex, intervals)) {
      notes.push(midi)
    }
  }
  return notes
}

export function pickUniqueNotes(source: number[], count: number) {
  const pool = [...source]
  const picked: number[] = []
  while (picked.length < count && pool.length) {
    const index = Math.floor(Math.random() * pool.length)
    picked.push(pool[index]!)
    pool.splice(index, 1)
  }
  return picked
}

export function findPreviousScaleNote(startMidi: number, keyIndex: number, intervals: number[]) {
  for (let midi = startMidi - 1; midi >= 0 && midi >= startMidi - 24; midi--) {
    if (isNoteInScale(midi, keyIndex, intervals)) {
      return midi
    }
  }
  return startMidi
}
