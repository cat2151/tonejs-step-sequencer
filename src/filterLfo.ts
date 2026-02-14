import * as Tone from 'tone'
import type { SequencerNodes, SequenceEvent } from 'tonejs-json-sequencer'

type LfoRange = { frequency: number; min: number; max: number }
type FilterLfoConfig = { nodeId: number; cutoff: LfoRange; q: LfoRange }

const lfoState = new Map<number, { cutoff: Tone.LFO; q: Tone.LFO }>()

function isNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function parseLfoRange(raw: unknown, fallbackFrequency: number, fallbackCenter: number): LfoRange {
  const range = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const frequency = isNumber(range.frequency) && range.frequency > 0 ? range.frequency : fallbackFrequency
  const min = isNumber(range.min) ? range.min : fallbackCenter * 0.5
  const max = isNumber(range.max) ? range.max : fallbackCenter * 1.5
  const clampedMin = Number.isFinite(min) ? min : fallbackCenter
  const clampedMax = Number.isFinite(max) ? max : clampedMin
  if (clampedMax > clampedMin) {
    return { frequency, min: clampedMin, max: clampedMax }
  }
  return { frequency, min: clampedMin, max: clampedMin + 1 }
}

function extractFilterLfoConfigs(events: SequenceEvent[]): FilterLfoConfig[] {
  const configs: FilterLfoConfig[] = []
  events.forEach((event) => {
    if ((event as { eventType?: string }).eventType !== 'createNode') return
    if ((event as { nodeType?: string }).nodeType !== 'Filter') return
    const nodeId = (event as { nodeId?: number }).nodeId
    if (typeof nodeId !== 'number') return
    const args = (event as { args?: unknown }).args
    const options = (Array.isArray(args) ? args[0] : args) as Record<string, unknown> | undefined
    const cutoffBase = isNumber(options?.frequency) ? options?.frequency : 1000
    const qBase = isNumber(options?.Q) ? options?.Q : 1
    const lfoOptions = (options?.lfo && typeof options.lfo === 'object'
      ? (options.lfo as Record<string, unknown>)
      : {}) as Record<string, unknown>
    const cutoff = parseLfoRange(lfoOptions.cutoff, 0.2, cutoffBase ?? 1000)
    const q = parseLfoRange(lfoOptions.q, 0.25, qBase ?? 1)
    configs.push({ nodeId, cutoff, q })
  })
  return configs
}

function disposeExisting(nodeId: number) {
  const existing = lfoState.get(nodeId)
  if (!existing) return
  existing.cutoff.stop()
  existing.cutoff.disconnect()
  existing.cutoff.dispose()
  existing.q.stop()
  existing.q.disconnect()
  existing.q.dispose()
  lfoState.delete(nodeId)
}

export function disposeFilterLfos() {
  Array.from(lfoState.keys()).forEach((nodeId) => disposeExisting(nodeId))
}

export function applyFilterLfos(nodes: SequencerNodes, events: SequenceEvent[]) {
  const configs = extractFilterLfoConfigs(events)
  const validIds = new Set(configs.map((config) => config.nodeId))
  Array.from(lfoState.keys()).forEach((nodeId) => {
    if (!validIds.has(nodeId)) {
      disposeExisting(nodeId)
    }
  })
  configs.forEach((config) => {
    disposeExisting(config.nodeId)
    const node = nodes.get(config.nodeId)
    if (!(node instanceof Tone.Filter)) return
    const cutoffLfo = new Tone.LFO({
      frequency: config.cutoff.frequency,
      min: config.cutoff.min,
      max: config.cutoff.max,
    })
    cutoffLfo.connect(node.frequency)
    cutoffLfo.start()
    const qLfo = new Tone.LFO({
      frequency: config.q.frequency,
      min: config.q.min,
      max: config.q.max,
    })
    qLfo.connect(node.Q)
    qLfo.start()
    lfoState.set(config.nodeId, { cutoff: cutoffLfo, q: qLfo })
  })
}
