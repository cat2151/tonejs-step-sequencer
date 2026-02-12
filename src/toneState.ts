import type { SequenceEvent } from 'tonejs-json-sequencer'
import { initWasm as initMmlWasm, mml2json } from 'tonejs-mml-to-json'
import { GROUP_A_NODE_ID, GROUP_B_NODE_ID, MONITOR_A_NODE_ID, MONITOR_B_NODE_ID, MONITOR_NODE_ID, type Group } from './constants'

type TonePreset = {
  id: string
  label: string
  mml: string
}

export type ToneState = {
  presetId: string
  mmlText: string
  jsonText: string
  events: SequenceEvent[]
  instrumentNodeId: number
  open: boolean
  error: string
}

export type ToneControls = {
  toggle: HTMLButtonElement
  body: HTMLDivElement
  presetSelect: HTMLSelectElement
  mmlTextarea: HTMLTextAreaElement
  jsonTextarea: HTMLTextAreaElement
  status: HTMLSpanElement
  randomToggle: HTMLButtonElement
  randomBody: HTMLDivElement
  randomTextarea: HTMLTextAreaElement
  randomError: HTMLDivElement
}

const TONE_EVENT_TYPES = new Set(['createNode', 'connect', 'set'])

export const tonePresets: TonePreset[] = [
  {
    id: 'fm-pingpong',
    label: 'FMSynth + PingPongDelay',
    mml: `@FMSynth{
  "volume": 0,
  "detune": 0,
  "portamento": 0,
  "harmonicity": 3,
  "oscillator": {
    "partialCount": 0,
    "partials": [],
    "phase": 0,
    "type": "sine"
  },
  "envelope": {
    "attack": 0.02,
    "attackCurve": "linear",
    "decay": 0.15,
    "decayCurve": "exponential",
    "sustain": 0.6,
    "release": 0.8,
    "releaseCurve": "exponential"
  },
  "modulation": {
    "partialCount": 0,
    "partials": [],
    "phase": 0,
    "type": "square"
  },
  "modulationEnvelope": {
    "attack": 0.5,
    "attackCurve": "linear",
    "decay": 0,
    "decayCurve": "exponential",
    "release": 0.5,
    "releaseCurve": "exponential",
    "sustain": 1
  },
  "modulationIndex": 10
}
@PingPongDelay{
  "wet": 1,
  "feedback": 0.35,
  "delayTime": "8n",
  "maxDelay": 1
}
o4 l8 cdefgab<c`,
  },
  {
    id: 'mono-chebyshev',
    label: 'MonoSynth + Chebyshev',
    mml: `@MonoSynth{
  "volume": 0,
  "detune": 0,
  "portamento": 0,
  "filter": {
    "Q": 2,
    "detune": 0,
    "frequency": 350,
    "gain": 0,
    "type": "lowpass",
    "rolloff": -12
  },
  "envelope": {
    "attack": 0.05,
    "attackCurve": "linear",
    "decay": 0.3,
    "decayCurve": "exponential",
    "sustain": 0.2,
    "release": 1.2,
    "releaseCurve": "exponential"
  },
  "filterEnvelope": {
    "attack": 0.6,
    "attackCurve": "linear",
    "decay": 0.2,
    "decayCurve": "exponential",
    "release": 2,
    "releaseCurve": "exponential",
    "sustain": 0.5,
    "baseFrequency": 200,
    "exponent": 2,
    "octaves": 3
  },
  "oscillator": {
    "detune": 0,
    "frequency": 440,
    "partialCount": 0,
    "partials": [],
    "phase": 0,
    "type": "sawtooth"
  }
}
@Chebyshev{
  "wet": 1,
  "order": 32,
  "oversample": "2x"
}
o3 l8 c c d d# f f g g`,
  },
  {
    id: 'synth-chorus',
    label: 'Synth + Chorus',
    mml: `@Synth{
  "volume": 0,
  "detune": 0,
  "portamento": 0,
  "oscillator": {
    "partialCount": 0,
    "partials": [],
    "phase": 0,
    "type": "sawtooth"
  },
  "envelope": {
    "attack": 0.08,
    "attackCurve": "linear",
    "decay": 0.2,
    "decayCurve": "exponential",
    "sustain": 0.4,
    "release": 0.9,
    "releaseCurve": "exponential"
  }
}
@Chorus{
  "wet": 0.5,
  "feedback": 0,
  "frequency": 4,
  "delayTime": 2.5,
  "depth": 0.6,
  "type": "sine",
  "spread": 180
}
o4 l8 c e g c e g<c`,
  },
]

export const toneStates: Record<Group, ToneState> = {
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

export const toneControls: Partial<Record<Group, ToneControls>> = {}

let mmlInitPromise: Promise<void> | null = null

export function getPresetById(id: string) {
  return tonePresets.find((preset) => preset.id === id)
}

export function buildFallbackToneConfig(group: Group) {
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

export function normalizeToneEvents(events: SequenceEvent[], group: Group) {
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

export async function applyMmlToToneState(group: Group, mmlText: string) {
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

export function applyJsonToToneState(group: Group, jsonText: string) {
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
