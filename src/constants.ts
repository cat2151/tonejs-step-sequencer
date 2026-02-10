import * as Tone from 'tone'

export type Group = 'A' | 'B'

export const MONITOR_NODE_ID = 1
export const MONITOR_A_NODE_ID = 10011
export const MONITOR_B_NODE_ID = 10021
export const STEPS = 16
export const DEFAULT_MIDI_NOTE = 60
export const DEFAULT_BPM = 120
export const DEFAULT_NOTE_ROWS = ['C5', 'C4', 'C3', 'C2', 'C1', 'C0'] as const
export const GROUP_SIZE = 3
export const GROUP_A_NODE_ID = 10
export const GROUP_B_NODE_ID = 20
export const PPQ = Tone.Transport.PPQ ?? 192
export const SIXTEENTH_TICKS = PPQ / 4
export const FFT_NORMALIZATION_OFFSET = 140
export const WAVEFORM_BUFFER_MIN = 4096
export const WAVEFORM_BUFFER_MAX = 65536
export const MIN_STANDARD_DEVIATION = 1e-6
export const MAX_WAVEFORM_GAIN = 64
export const WAVEFORM_SILENCE_THRESHOLD = 1e-4
