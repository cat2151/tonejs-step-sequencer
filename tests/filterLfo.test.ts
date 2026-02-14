import { beforeEach, describe, expect, it, vi } from 'vitest'

const lfoInstances: Array<{
  connections: unknown[]
  started: boolean
  stopped: boolean
  disconnected: boolean
  disposed: boolean
}> = []

vi.mock('tone', () => {
  class MockParam {
    connections: unknown[] = []
  }
  class MockFilter {
    frequency: MockParam
    Q: MockParam
    opts: unknown
    constructor(opts: unknown) {
      this.opts = opts
      this.frequency = new MockParam()
      this.Q = new MockParam()
    }
  }
  class MockLFO {
    connections: unknown[]
    started: boolean
    stopped: boolean
    disconnected: boolean
    disposed: boolean
    opts: unknown
    constructor(opts: unknown) {
      this.opts = opts
      this.connections = []
      this.started = false
      this.stopped = false
      this.disconnected = false
      this.disposed = false
      lfoInstances.push(this)
    }
    connect(target: unknown) {
      this.connections.push(target)
    }
    start() {
      this.started = true
    }
    stop() {
      this.stopped = true
    }
    disconnect() {
      this.disconnected = true
    }
    dispose() {
      this.disposed = true
    }
  }
  return { Filter: MockFilter, LFO: MockLFO }
})

import * as Tone from 'tone'
import type { SequenceEvent } from 'tonejs-json-sequencer'
import { applyFilterLfos, disposeFilterLfos } from '../src/filterLfo'

describe('filterLfo', () => {
  beforeEach(() => {
    disposeFilterLfos()
    lfoInstances.length = 0
  })

  it('skips filters without lfo config', () => {
    const filter = new Tone.Filter({})
    const nodes = { get: vi.fn().mockReturnValue(filter) } as unknown as {
      get: (id: number) => unknown
    }
    const events: SequenceEvent[] = [
      {
        eventType: 'createNode',
        nodeId: 1,
        nodeType: 'Filter',
        args: [{ type: 'lowpass', frequency: 1000, Q: 1 }],
      },
    ]

    applyFilterLfos(nodes as never, events)

    expect(lfoInstances).toHaveLength(0)
  })

  it('creates and connects LFOs when lfo config is present', () => {
    const filter = new Tone.Filter({})
    const nodes = { get: vi.fn().mockReturnValue(filter) } as unknown as {
      get: (id: number) => unknown
    }
    const events: SequenceEvent[] = [
      {
        eventType: 'createNode',
        nodeId: 1,
        nodeType: 'Filter',
        args: [
          {
            type: 'lowpass',
            frequency: 1200,
            Q: 1,
            lfo: {
              cutoff: { frequency: 0.2, min: 400, max: 2200 },
              q: { frequency: 0.25, min: 0.5, max: 6 },
            },
          },
        ],
      },
    ]

    applyFilterLfos(nodes as never, events)

    expect(lfoInstances).toHaveLength(2)
    expect(lfoInstances[0]?.started).toBe(true)
    expect(lfoInstances[1]?.started).toBe(true)
    expect(lfoInstances[0]?.connections).toContain(filter.frequency)
    expect(lfoInstances[1]?.connections).toContain(filter.Q)
  })

  it('disposes previous LFOs when configs are removed', () => {
    const filter = new Tone.Filter({})
    const nodes = { get: vi.fn().mockReturnValue(filter) } as unknown as {
      get: (id: number) => unknown
    }
    const eventsWithLfo: SequenceEvent[] = [
      {
        eventType: 'createNode',
        nodeId: 1,
        nodeType: 'Filter',
        args: [{ lfo: { cutoff: {}, q: {} } }],
      },
    ]

    applyFilterLfos(nodes as never, eventsWithLfo)
    expect(lfoInstances).toHaveLength(2)
    const first = [...lfoInstances]

    applyFilterLfos(nodes as never, [])

    expect(first[0]?.stopped).toBe(true)
    expect(first[0]?.disconnected).toBe(true)
    expect(first[0]?.disposed).toBe(true)
    expect(first[1]?.disposed).toBe(true)
    expect(lfoInstances).toHaveLength(2)
  })
})
